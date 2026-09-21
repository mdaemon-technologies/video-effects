# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-08-24

### Added

- `degraded` events carry a `reason`: `"budget"` when the watchdog tripped
  because the machine is too slow, `"segmentation"` when MediaPipe failed
  persistently. Both mean the same thing to a consumer — the effect is off and
  the raw track is carrying the call — but they need different diagnostics.
- `documentRef` option, matching the injection point `Compositor` already had.
  It supplies the document used for the compositing canvases and the fallback
  path's `<video>` element.
- Tests covering both capture paths end to end, driven through Node's web
  streams and hand-rolled WebCodecs constructors, against a fake segmenter that
  enforces MediaPipe's real timestamp contract. Neither path had any coverage
  before, which is how an unguarded timestamp shipped.

### Changed

- `fx.degraded` now reports whether the effect was given up on for any reason,
  rather than reading the watchdog alone.

### Fixed

- **A repeated frame timestamp froze the published track permanently.** The
  WebCodecs path handed MediaPipe the source's own timestamp unguarded. VIDEO
  running mode requires strictly increasing timestamps, and a capture source
  that repeats one — a stalled camera, a duplicated frame, a clock coarsened for
  fingerprinting defence — faults the graph.

  The fault was unrecoverable and silent. `renderFrame()` caught the throw and
  returned false, so the transform never enqueued; every later frame threw the
  same way, so nothing was ever enqueued again. The track stayed live while
  producing no frames at all, which every other participant saw as a frozen
  picture. The watchdog could not rescue it either, because it only ever
  recorded frames that actually rendered — so `degraded` never fired and the
  republish path consumers built for the slow-machine case was never reached.

  The timestamp handed to the segmenter is now forced monotonic on both capture
  paths, bumped by a millisecond when a source repeats or rewinds one. Only the
  segmenter's input is adjusted: the frame published downstream keeps its own
  timestamp, so output pacing is untouched.

- **A failed segmentation no longer drops the frame.** It is composited with a
  null mask instead, which draws the camera frame untouched, so a fault shows as
  live unmasked video rather than a frozen picture. After a full second of
  consecutive failures the effect is abandoned through the same path the
  watchdog uses — `degraded`, then `stop()` — so consumers reach their recovery
  without needing to special-case it.

- **`error` is emitted once per run of failures, not once per frame.** A
  permanent fault at 30fps previously fired a consumer's error handler thirty
  times a second, which is its own outage.

- **Re-applying an effect could feed a stale frame to the new segmenter.**
  `process()` calls `stop()` and then sets up again across two awaits; an
  aborted pipeline's in-flight callbacks re-read `running`, saw it true again,
  and could hand a frame — and its already-consumed timestamp — to the segmenter
  that replaced theirs. Worse, `process()` assigned the new segmenter straight to
  a shared field, so two overlapping calls clobbered and leaked one another's.

  Every pipeline now carries a generation stamp that `stop()` bumps. Frame
  callbacks check it before touching anything, and `process()` re-checks it after
  each await: a superseded call closes the segmenter it built and returns the
  input track instead of racing the call that replaced it.

## [1.1.1] - 2026-08-21

### Added

- Tests covering the compositor's mask polarity and its composite-operation
  order, driven through the existing `documentRef` injection point. `writeMask()`
  and `render()` previously had no coverage at all, which is why the inversion
  shipped.

### Fixed

- **The segmentation mask was inverted**: background blur and background images
  were composited over the person while the real room stayed visible around
  them. Any effect backed by segmentation was affected — only the native
  `backgroundBlur` path, which does no compositing of its own, was correct.

  `MPMask.getAsUint8Array()` returns the winning *category index* per pixel for
  a category mask, not an intensity, and the selfie model labels the person as
  category 0. The compositor read the mask as an intensity — "non-zero means
  foreground" — so it selected exactly the wrong half of the frame before
  drawing the replacement behind what survived.

  The foreground test is now an equality against a named `PERSON_CATEGORY`
  constant, so a model with a different label map is a one-line change.

## [1.1.0] - 2026-08-20

### Changed

- **Requires a peer dependency upgrade** — `@mediapipe/tasks-vision` now
  requires `^1.0.0` (was `^0.10.0`). Consumers pinned to 0.10.x must upgrade in
  step; because the runtime is a peer dependency, a mismatch surfaces as an
  install-time peer conflict rather than at runtime.

  No API change accompanies this. Every MediaPipe entry point this package uses
  — `FilesetResolver.forVisionTasks()`, `ImageSegmenter.createFromOptions()`,
  `segmentForVideo()` and the `MPMask` category mask — is identical in 1.x. The
  breaking change in MediaPipe 1.0 is confined to `InteractiveSegmenter`, which
  this package does not use.

- The WASM artifact filenames are unchanged, so an existing `assetBase`
  directory keeps working. Re-copy the files to pick up the 1.x runtime: the
  SIMD binary grew from roughly 10.6 MB to 11.2 MB.

### Fixed

- README told you to copy `selfie_segmenter_landscape.tflite` out of
  `node_modules/@mediapipe/tasks-vision/wasm/`. That file has never shipped in
  the npm package; it comes from Google's MediaPipe model garden. Following the
  old instructions produced a 404 at the first segmentation attempt.
- README documented the asset payload as "roughly 3 MB total", which described
  the gzipped transfer of one variant rather than what lands on disk. Both
  figures are now given, along with a note that only one of the SIMD/no-SIMD
  pair is fetched per browser.

## [1.0.0] - 2026-08-20

Initial release.

`@mediapipe/tasks-vision` is an **optional peer dependency**, resolved lazily
the first time a segmentation-backed effect is enabled. It is never bundled,
so consumers that only use native blur never download it.

The MediaPipe WASM runtime and `.tflite` model are not shipped in the package;
serve them yourself and point `assetBase` at them.

### Added

- `VideoEffects` — sender-side camera background blur and replacement with a
  track-in/track-out API (`process(track) -> MediaStreamTrack`).
- Three capture paths, selected automatically: the native `backgroundBlur`
  constraint, WebCodecs (`MediaStreamTrackProcessor` / `MediaStreamTrackGenerator`),
  and a `<video>` + canvas `captureStream()` fallback.
- `setEffect()` supporting `none`, `blur` with an adjustable strength, and
  `image` from a URL, `ImageBitmap`, or `HTMLImageElement`.
- `FrameWatchdog` — rolling frame-budget monitor that disables the effect and
  emits `degraded` when segmentation is consistently too slow for the machine,
  rather than letting the whole call stutter.
- `degraded`, `error` and `effectchange` events via a dependency-free emitter.
- `detectCapabilities()` and `supportsNativeBackgroundBlur()` for feature
  probing ahead of showing the UI.
- `coverRect()` aspect-preserving fit for background images.

[1.2.0]: https://www.npmjs.com/package/@mdaemon/video-effects/v/1.2.0
[1.1.1]: https://www.npmjs.com/package/@mdaemon/video-effects/v/1.1.1
[1.1.0]: https://www.npmjs.com/package/@mdaemon/video-effects/v/1.1.0
[1.0.0]: https://www.npmjs.com/package/@mdaemon/video-effects/v/1.0.0

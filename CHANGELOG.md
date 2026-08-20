# Changelog

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

## [1.0.0] - 2026-08-19

Initial release.

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

### Notes

- `@mediapipe/tasks-vision` is an **optional peer dependency**, resolved lazily
  the first time a segmentation-backed effect is enabled. It is never bundled,
  so consumers that only use native blur never download it.
- The MediaPipe WASM runtime and `.tflite` model are not shipped in the package;
  serve them yourself and point `assetBase` at them.

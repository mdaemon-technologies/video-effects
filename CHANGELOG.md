# Changelog

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

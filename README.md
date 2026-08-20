# @mdaemon/video-effects, camera background blur and replacement for WebRTC video tracks
[![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmdaemon-technologies%2Fvideo-effects%2Fmain%2Fpackage.json&query=%24.version&prefix=v&label=npm&color=blue)](https://www.npmjs.com/package/@mdaemon/video-effects) [![Static Badge](https://img.shields.io/badge/node-v20%2B-blue?style=flat&label=node&color=blue)](https://nodejs.org) [![install size](https://packagephobia.com/badge?p=@mdaemon/video-effects)](https://packagephobia.com/result?p=@mdaemon/video-effects) [![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmdaemon-technologies%2Fvideo-effects%2Fmain%2Fpackage.json&query=%24.license&prefix=v&label=license&color=green)](https://github.com/mdaemon-technologies/video-effects/blob/main/LICENSE) [![Node.js CI](https://github.com/mdaemon-technologies/video-effects/actions/workflows/node.js.yml/badge.svg)](https://github.com/mdaemon-technologies/video-effects/actions/workflows/node.js.yml)

[ [@mdaemon/video-effects on npm](https://www.npmjs.com/package/@mdaemon/video-effects "npm") ]

Track in, track out. Give it the local camera track, get back a track whose
background is blurred or replaced, and publish that instead. Everything
downstream — `producer.produce()`, simulcast, the local preview element — keeps
working on an ordinary `MediaStreamTrack`.

Processing runs **sender-side**, once per publisher, on that publisher's own
outgoing stream. The cost does not grow with the number of people in the room:
a 20-person call costs each participant exactly what a 2-person call costs.

## Install

```cmd
$ npm install @mdaemon/video-effects --save
```

`@mediapipe/tasks-vision` is an optional peer dependency. Install it too unless
you only ever intend to use the browser's native blur:

```cmd
$ npm install @mediapipe/tasks-vision --save
```

## Serving the assets

MediaPipe needs its WASM runtime and a `.tflite` model at runtime. They are not
bundled — every consumer serves static files from a different place, so you pass
the location in as `assetBase`.

Copy these out of `node_modules/@mediapipe/tasks-vision/wasm/` into whatever
directory you serve:

```
vision_wasm_internal.js
vision_wasm_internal.wasm
vision_wasm_nosimd_internal.js
vision_wasm_nosimd_internal.wasm
selfie_segmenter_landscape.tflite
```

The model file comes from Google's MediaPipe model garden. Roughly 3 MB total.

If your app sets a Content Security Policy, it needs `'wasm-unsafe-eval'` in
`script-src` and `worker-src 'self' blob:`.

## Usage

### Node Modules
```js
import VideoEffects from "@mdaemon/video-effects/dist/videoEffects.mjs";
```

### Node CommonJS
```js
const VideoEffects = require("@mdaemon/video-effects/dist/videoEffects.cjs");
```

### Web
```html
<script type="text/javascript" src="/path_to_modules/dist/videoEffects.umd.js"></script>
```

## API

### `new VideoEffects(options)`

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `assetBase` | `string` | **required** | Directory serving the MediaPipe WASM artifacts. |
| `modelAssetPath` | `string` | `<assetBase>/selfie_segmenter_landscape.tflite` | Override the model URL. |
| `targetFps` | `number` | `30` | Output frame rate for the canvas fallback path. |
| `preferNativeBlur` | `boolean` | `true` | Use hardware blur when the platform offers it. |
| `watchdog` | `WatchdogOptions \| false` | `{}` | Frame-budget monitor; `false` disables it. |

### `setEffect(effect): Promise<void>`

```js
await fx.setEffect({ type: "none" });
await fx.setEffect({ type: "blur", strength: 12 });          // strength in px, 0 < n <= 100
await fx.setEffect({ type: "image", source: "/bg/office.jpg" });
await fx.setEffect({ type: "image", source: someImageBitmap }); // pre-decoded, no fetch
```

Passing a URL means the first call fetches and decodes before the effect takes
hold. Pre-decode to an `ImageBitmap` to avoid a frame or two of unmasked video.

### `process(track, options?): Promise<MediaStreamTrack>`

Wraps a camera track. The returned track may be the *input* track itself when
the effect is `none`, when the platform blurred it in hardware, or when no
capture path is available — callers do not need to branch on that.

```js
const fx = new VideoEffects({ assetBase: "/wasm" });
await fx.setEffect({ type: "blur" });

const raw = (await navigator.mediaDevices.getUserMedia({ video: true })).getVideoTracks()[0];
const masked = await fx.process(raw);

previewElement.srcObject = new MediaStream([masked]);
await producerTransport.produce({ track: masked });
```

Pass `{ visionModule }` as the second argument when MediaPipe arrives by
`<script>` tag rather than through a bundler.

Toggling the effect on an already-published track needs no renegotiation:

```js
await fx.setEffect({ type: "none" });
await producer.replaceTrack({ track: await fx.process(raw) });
```

### Events

```js
fx.on("degraded", ({ averageMs, budgetMs }) => { /* effect gave up; raw video continues */ });
fx.on("error", (error) => { /* effect is off */ });
fx.on("effectchange", (effect) => { /* reflect the new state in the UI */ });
```

`degraded` fires when segmentation is consistently too slow for the machine. The
effect switches off and the raw track keeps flowing — a call without a blurred
background beats a call that stutters. Recovery is deliberately not automatic;
flapping the effect on and off reads as a bug. Call `process()` again to retry.

### Other members

| Member | Description |
|--------|-------------|
| `VideoEffects.isSupported()` | Whether any capture path exists in this browser. |
| `VideoEffects.capabilities()` | Full capability breakdown. |
| `fx.effect` | The current effect. |
| `fx.degraded` | Whether the watchdog has given up. |
| `fx.usingHardwareBlur` | Whether the platform is doing the work. |
| `fx.stop()` | Tear down processing; leaves the source track alone. |
| `fx.destroy()` | `stop()` plus drop all listeners. |

## How it picks a path

1. **Native `backgroundBlur` constraint** — Chromium 114+ on supported hardware.
   Costs nothing: no WASM download, no per-frame work, no extra encode. Blur
   only; there is no platform equivalent for image replacement.
2. **WebCodecs** — `MediaStreamTrackProcessor` / `MediaStreamTrackGenerator`.
   Frame-by-frame transform, lowest overhead of the two software paths.
3. **Canvas capture** — a `<video>` element driven by `requestVideoFrameCallback`
   into a canvas, published via `captureStream()`. Firefox and Safari.

Output tracks are given `contentHint = "motion"`, because canvas-derived tracks
otherwise default to preferring resolution over framerate, which fights a
simulcast ladder.

## Browser support

| | Native blur | WebCodecs | Canvas capture |
|---|---|---|---|
| Chrome / Edge 114+ | yes, hardware permitting | yes | yes |
| Firefox | no | no | yes |
| Safari 16.4+ | no | no | yes |

`isSupported()` is false only where neither software path exists, in which case
`process()` returns the input track untouched and emits `error`.

## License

Published under the LGPL-2.1 license. See [LICENSE](./LICENSE).

MediaPipe and the selfie segmentation model are Apache-2.0, copyright Google LLC.

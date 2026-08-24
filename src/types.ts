/**
 * The background treatment applied to the local camera track.
 *
 * `image.source` accepts a URL, a pre-decoded `ImageBitmap`, or an
 * `HTMLImageElement`. Passing a URL means the first `setEffect` call has to
 * fetch and decode before the effect takes hold; pre-decoding avoids a visible
 * frame or two of unmasked video.
 */
export type BackgroundEffect =
  | { type: "none" }
  | { type: "blur"; strength?: number }
  | { type: "image"; source: string | ImageBitmap | HTMLImageElement };

export interface WatchdogOptions {
  /**
   * Per-frame processing budget in milliseconds. Frames slower than this count
   * against the trip ratio. Default 22ms, which leaves headroom at 30fps
   * (33.3ms/frame) for the encoder and the rest of the page.
   */
  budgetMs?: number;
  /** Rolling sample count considered before tripping. Default 60 (~2s at 30fps). */
  windowSize?: number;
  /** Fraction of the window that must exceed budget to trip. Default 0.5. */
  tripRatio?: number;
}

export interface VideoEffectsOptions {
  /**
   * Base URL holding the MediaPipe WASM artifacts
   * (`vision_wasm_internal.{js,wasm}` and the nosimd variants).
   *
   * Every consumer serves these from a different place, so there is no default.
   */
  assetBase: string;
  /**
   * URL of the `.tflite` segmentation model. Defaults to
   * `<assetBase>/selfie_segmenter_landscape.tflite`.
   */
  modelAssetPath?: string;
  /** Output frame rate for the fallback capture path. Default 30. */
  targetFps?: number;
  /**
   * Use the browser's hardware `backgroundBlur` constraint when it is available
   * and the requested effect is a plain blur. Default true.
   */
  preferNativeBlur?: boolean;
  /** Frame-budget watchdog settings, or `false` to disable it entirely. */
  watchdog?: WatchdogOptions | false;
  /**
   * Document used to create the compositing canvases and the fallback path's
   * `<video>` element. Defaults to the ambient `document`; supplying one is the
   * injection point that makes the capture paths testable outside a browser.
   */
  documentRef?: Document;
}

export interface DegradedEvent {
  /** Mean frame processing time over the sample window, in milliseconds. */
  averageMs: number;
  /** The budget that was exceeded. */
  budgetMs: number;
  /**
   * Why the effect was abandoned.
   *
   * `"budget"` is the watchdog: segmentation was consistently too slow for the
   * machine. `"segmentation"` is a persistent failure inside MediaPipe - raw
   * video kept flowing throughout, but the effect could not be applied to it.
   */
  reason: "budget" | "segmentation";
}

export interface VideoEffectsEventMap {
  /**
   * The effect was abandoned and the raw camera track is passing through
   * instead: either the watchdog tripped because processing is too slow on this
   * machine, or segmentation failed for long enough to be considered permanent.
   * Not fatal — the call keeps running without the effect, and `reason` tells
   * the two apart.
   */
  degraded: DegradedEvent;
  /** A processing or initialisation error. The effect is off when this fires. */
  error: Error;
  /** The active effect changed, including to `{ type: "none" }`. */
  effectchange: BackgroundEffect;
}

export type VideoEffectsEvent = keyof VideoEffectsEventMap;

export interface Capabilities {
  /** `MediaStreamTrackProcessor` + `MediaStreamTrackGenerator` (Chromium). */
  insertableStreams: boolean;
  /** `HTMLCanvasElement.captureStream` fallback path (Firefox, Safari). */
  captureStream: boolean;
  /** Hardware background blur via `applyConstraints({ backgroundBlur: true })`. */
  nativeBackgroundBlur: boolean;
  /** At least one usable capture path exists. */
  supported: boolean;
}

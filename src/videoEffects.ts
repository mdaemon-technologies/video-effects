import TinyEmitter from "./emitter.js";
import Compositor from "./compositor.js";
import FrameWatchdog from "./watchdog.js";
import SelfieSegmenter from "./segmenter.js";
import { detectCapabilities } from "./capabilities.js";
import { applyNativeBackgroundBlur } from "./nativeBlur.js";
import { assertEffect, decodeBackground } from "./effects.js";
import type { VisionModule } from "./segmenter.js";
import type { WebCodecsScope, VideoFrameLike } from "./domExtras.js";
import type {
  BackgroundEffect,
  Capabilities,
  VideoEffectsEventMap,
  VideoEffectsOptions
} from "./types.js";

export type {
  BackgroundEffect,
  Capabilities,
  DegradedEvent,
  VideoEffectsEvent,
  VideoEffectsEventMap,
  VideoEffectsOptions,
  WatchdogOptions
} from "./types.js";

const DEFAULT_FPS = 30;

export interface ProcessOptions {
  /** Pre-resolved MediaPipe module, for consumers that load it by script tag. */
  visionModule?: VisionModule;
}

/**
 * Sender-side camera background effects.
 *
 * Takes the local camera track, returns a replacement track with the background
 * blurred or replaced, and leaves everything downstream - producer.produce(),
 * simulcast, the local preview - working on an ordinary MediaStreamTrack.
 *
 * Processing happens once per publisher, on their own outgoing stream, so the
 * cost is independent of how many people are in the room.
 */
export default class VideoEffects extends TinyEmitter<VideoEffectsEventMap> {
  private readonly assetBase: string;
  private readonly modelAssetPath?: string;
  private readonly targetFps: number;
  private readonly preferNativeBlur: boolean;
  private readonly watchdogOptions: VideoEffectsOptions["watchdog"];

  private currentEffect: BackgroundEffect = { type: "none" };
  private segmenter: SelfieSegmenter | null = null;
  private compositor: Compositor | null = null;
  private watchdog: FrameWatchdog | null = null;
  private backgroundImage: CanvasImageSource | null = null;

  private sourceTrack: MediaStreamTrack | null = null;
  private outputTrack: MediaStreamTrack | null = null;
  private usingNativeBlur = false;
  private teardown: Array<() => void> = [];
  private running = false;

  constructor(options: VideoEffectsOptions) {
    super();
    if (!options || !options.assetBase) {
      throw new Error("VideoEffects requires an assetBase pointing at the MediaPipe WASM artifacts");
    }
    const targetFps = options.targetFps ?? DEFAULT_FPS;
    if (!(targetFps > 0) || targetFps > 60) {
      throw new RangeError(`targetFps must be within (0, 60], received ${targetFps}`);
    }
    this.assetBase = options.assetBase;
    this.modelAssetPath = options.modelAssetPath;
    this.targetFps = targetFps;
    this.preferNativeBlur = options.preferNativeBlur ?? true;
    this.watchdogOptions = options.watchdog;
  }

  static capabilities(): Capabilities {
    return detectCapabilities();
  }

  static isSupported(): boolean {
    return detectCapabilities().supported;
  }

  get effect(): BackgroundEffect {
    return this.currentEffect;
  }

  /** True once the watchdog gave up and the raw track is passing through. */
  get degraded(): boolean {
    return this.watchdog ? this.watchdog.tripped : false;
  }

  /** True when the platform is blurring in hardware and we are doing nothing. */
  get usingHardwareBlur(): boolean {
    return this.usingNativeBlur;
  }

  /**
   * Set the background treatment. Safe to call before or after process().
   */
  async setEffect(effect: BackgroundEffect): Promise<void> {
    assertEffect(effect);
    this.currentEffect = effect;

    this.backgroundImage = null;
    if (effect.type === "image") {
      this.backgroundImage = await decodeBackground(effect.source);
    }

    // A track already flowing through the native blur path has to be taken back
    // out of it when the user switches to an image or turns the effect off.
    if (this.usingNativeBlur && this.sourceTrack) {
      await applyNativeBackgroundBlur(this.sourceTrack, effect.type === "blur");
      if (effect.type !== "blur") {
        this.usingNativeBlur = false;
      }
    }

    this.emit("effectchange", effect);
  }

  /**
   * Wrap a camera track.
   *
   * @returns the track to publish and preview. May be the input track itself
   *   when the effect is none, when the platform blurs in hardware, or when no
   *   capture path is available - callers do not need to branch on that.
   */
  async process(track: MediaStreamTrack, processOptions: ProcessOptions = {}): Promise<MediaStreamTrack> {
    if (!track || track.kind !== "video") {
      throw new TypeError("process() requires a video MediaStreamTrack");
    }
    this.stop();
    this.sourceTrack = track;

    if (this.currentEffect.type === "none") {
      return track;
    }

    // Free path first: let the OS do it if it can.
    if (this.preferNativeBlur && this.currentEffect.type === "blur") {
      const applied = await applyNativeBackgroundBlur(track, true);
      if (applied) {
        this.usingNativeBlur = true;
        return track;
      }
    }

    const capabilities = detectCapabilities();
    if (!capabilities.supported) {
      this.emit("error", new Error("no usable frame capture path in this browser; effect disabled"));
      return track;
    }

    try {
      this.segmenter = await SelfieSegmenter.create({
        assetBase: this.assetBase,
        modelAssetPath: this.modelAssetPath,
        visionModule: processOptions.visionModule
      });
    } catch (cause) {
      this.emit("error", cause instanceof Error ? cause : new Error(String(cause)));
      return track;
    }

    const settings = track.getSettings();
    const width = settings.width ?? 640;
    const height = settings.height ?? 360;
    this.compositor = new Compositor(width, height);
    this.watchdog = this.watchdogOptions === false ? null : new FrameWatchdog(this.watchdogOptions ?? {});
    this.running = true;

    try {
      this.outputTrack = capabilities.insertableStreams
        ? this.startWebCodecsPath(track)
        : this.startCanvasPath(track, width, height);
    } catch (cause) {
      this.stop();
      this.emit("error", cause instanceof Error ? cause : new Error(String(cause)));
      return track;
    }

    // Canvas-derived tracks default to preferring resolution, which fights the
    // simulcast ladder; motion keeps framerate stable and lets the encoder drop
    // resolution instead.
    setContentHint(this.outputTrack, "motion");
    return this.outputTrack;
  }

  /** Render one frame through the segmenter, with watchdog accounting. */
  private renderFrame(source: CanvasImageSource, timestampMs: number): boolean {
    if (!this.compositor || !this.segmenter) {
      return false;
    }
    const started = performance.now();
    let mask = null;
    try {
      mask = this.segmenter.segment(source, timestampMs);
    } catch (cause) {
      this.emit("error", cause instanceof Error ? cause : new Error(String(cause)));
      return false;
    }
    this.compositor.render(source, mask, this.currentEffect, this.backgroundImage);

    if (this.watchdog && this.watchdog.record(performance.now() - started)) {
      this.emit("degraded", {
        averageMs: this.watchdog.averageMs,
        budgetMs: this.watchdog.budgetMs
      });
      this.stop();
    }
    return true;
  }

  /** Chromium: WebCodecs frame-by-frame transform. */
  private startWebCodecsPath(track: MediaStreamTrack): MediaStreamTrack {
    const scope = globalThis as unknown as WebCodecsScope;
    const processor = new scope.MediaStreamTrackProcessor({ track });
    const generator = new scope.MediaStreamTrackGenerator({ kind: "video" });

    const transformer = new TransformStream<VideoFrameLike, VideoFrameLike>({
      transform: (frame, controller) => {
        if (!this.running || !this.compositor) {
          frame.close();
          return;
        }
        this.compositor.resize(frame.displayWidth, frame.displayHeight);
        const rendered = this.renderFrame(frame as unknown as CanvasImageSource, frame.timestamp / 1000);
        if (rendered && this.compositor) {
          controller.enqueue(new scope.VideoFrame(this.compositor.canvas, {
            timestamp: frame.timestamp,
            alpha: "discard"
          }));
        }
        frame.close();
      }
    });

    const abort = new AbortController();
    processor.readable
      .pipeThrough(transformer, { signal: abort.signal })
      .pipeTo(generator.writable, { signal: abort.signal })
      .catch((cause: unknown) => {
        if (!abort.signal.aborted) {
          this.emit("error", cause instanceof Error ? cause : new Error(String(cause)));
        }
      });

    this.teardown.push(() => abort.abort());
    return generator;
  }

  /** Firefox and Safari: video element into a captured canvas. */
  private startCanvasPath(track: MediaStreamTrack, width: number, height: number): MediaStreamTrack {
    const video = document.createElement("video");
    video.srcObject = new MediaStream([track]);
    video.muted = true;
    video.playsInline = true;
    void Promise.resolve(video.play()).catch((cause: unknown) => {
      this.emit("error", cause instanceof Error ? cause : new Error(String(cause)));
    });

    const compositor = this.compositor;
    if (!compositor) {
      throw new Error("compositor was not initialised");
    }
    compositor.resize(width, height);

    let handle = 0;
    let timer: ReturnType<typeof setInterval> | null = null;
    const hasFrameCallback = typeof video.requestVideoFrameCallback === "function";

    const step = (now: number): void => {
      if (!this.running) {
        return;
      }
      if (video.videoWidth > 0) {
        compositor.resize(video.videoWidth, video.videoHeight);
        this.renderFrame(video, now);
      }
      if (hasFrameCallback && this.running) {
        handle = video.requestVideoFrameCallback(step);
      }
    };

    if (hasFrameCallback) {
      handle = video.requestVideoFrameCallback(step);
    } else {
      timer = setInterval(() => step(performance.now()), 1000 / this.targetFps);
    }

    this.teardown.push(() => {
      if (hasFrameCallback && handle && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(handle);
      }
      if (timer) {
        clearInterval(timer);
      }
      video.srcObject = null;
      video.remove();
    });

    const stream = compositor.canvas.captureStream(this.targetFps);
    const output = stream.getVideoTracks()[0];
    if (!output) {
      throw new Error("captureStream produced no video track");
    }
    return output;
  }

  /**
   * Tear down processing. The source track is left alone - its owner is
   * responsible for stopping the camera.
   */
  stop(): void {
    this.running = false;
    const pending = this.teardown.splice(0);
    for (const fn of pending) {
      try {
        fn();
      } catch {
        // Teardown is best-effort; a failure here must not mask the original cause.
      }
    }
    if (this.outputTrack) {
      this.outputTrack.stop();
      this.outputTrack = null;
    }
    if (this.segmenter) {
      this.segmenter.close();
      this.segmenter = null;
    }
    this.compositor = null;
  }

  /** Stop processing and drop every listener. */
  destroy(): void {
    this.stop();
    this.usingNativeBlur = false;
    this.sourceTrack = null;
    this.watchdog = null;
    this.backgroundImage = null;
    this.removeAllListeners();
  }
}

function setContentHint(track: MediaStreamTrack, hint: string): void {
  const candidate = track as MediaStreamTrack & { contentHint?: string };
  if ("contentHint" in candidate) {
    candidate.contentHint = hint;
  }
}

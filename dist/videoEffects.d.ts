import TinyEmitter from "./emitter.js";
import type { VisionModule } from "./segmenter.js";
import type { BackgroundEffect, Capabilities, VideoEffectsEventMap, VideoEffectsOptions } from "./types.js";
export type { BackgroundEffect, Capabilities, DegradedEvent, VideoEffectsEvent, VideoEffectsEventMap, VideoEffectsOptions, WatchdogOptions } from "./types.js";
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
    private readonly assetBase;
    private readonly modelAssetPath?;
    private readonly targetFps;
    private readonly preferNativeBlur;
    private readonly watchdogOptions;
    private currentEffect;
    private segmenter;
    private compositor;
    private watchdog;
    private backgroundImage;
    private sourceTrack;
    private outputTrack;
    private usingNativeBlur;
    private teardown;
    private running;
    constructor(options: VideoEffectsOptions);
    static capabilities(): Capabilities;
    static isSupported(): boolean;
    get effect(): BackgroundEffect;
    /** True once the watchdog gave up and the raw track is passing through. */
    get degraded(): boolean;
    /** True when the platform is blurring in hardware and we are doing nothing. */
    get usingHardwareBlur(): boolean;
    /**
     * Set the background treatment. Safe to call before or after process().
     */
    setEffect(effect: BackgroundEffect): Promise<void>;
    /**
     * Wrap a camera track.
     *
     * @returns the track to publish and preview. May be the input track itself
     *   when the effect is none, when the platform blurs in hardware, or when no
     *   capture path is available - callers do not need to branch on that.
     */
    process(track: MediaStreamTrack, processOptions?: ProcessOptions): Promise<MediaStreamTrack>;
    /** Render one frame through the segmenter, with watchdog accounting. */
    private renderFrame;
    /** Chromium: WebCodecs frame-by-frame transform. */
    private startWebCodecsPath;
    /** Firefox and Safari: video element into a captured canvas. */
    private startCanvasPath;
    /**
     * Tear down processing. The source track is left alone - its owner is
     * responsible for stopping the camera.
     */
    stop(): void;
    /** Stop processing and drop every listener. */
    destroy(): void;
}

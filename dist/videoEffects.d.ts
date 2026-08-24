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
    private readonly documentRef?;
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
    private gaveUp;
    private lastSegmentTimestamp;
    private consecutiveFailures;
    /**
     * Incremented by every `stop()`. Frame callbacks capture the value they were
     * started with and compare, so a pipeline that has been torn down cannot feed
     * whatever replaced it.
     */
    private generation;
    constructor(options: VideoEffectsOptions);
    static capabilities(): Capabilities;
    static isSupported(): boolean;
    get effect(): BackgroundEffect;
    /** True once the effect was abandoned and the raw track is passing through. */
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
    /**
     * Force the timestamp handed to MediaPipe to increase.
     *
     * VIDEO running mode rejects any timestamp that is not strictly greater than
     * the last one it accepted, and the rejection is permanent: the graph faults
     * and every frame after it throws the same way. Capture sources really do
     * repeat timestamps - a stalled camera, a duplicated frame, a clock coarsened
     * for fingerprinting defence - so the value is forced monotonic here rather
     * than trusted.
     *
     * Only the segmenter's input is adjusted. The frame published downstream keeps
     * its own timestamp, so output pacing is untouched. The step is a whole
     * millisecond because MediaPipe converts to microseconds internally and a
     * smaller nudge could round away.
     *
     * A non-finite candidate fails the comparison and falls through to the
     * increment, which is why there is no separate NaN check.
     */
    private nextTimestamp;
    /**
     * Render one frame through the segmenter, with watchdog accounting.
     *
     * @param candidateMs the source's own timestamp, in milliseconds. A candidate
     *   rather than the value used - see `nextTimestamp`.
     * @returns whether the compositor now holds a frame worth publishing.
     */
    private renderFrame;
    /** Account for one failed segmentation, and give up if they keep coming. */
    private noteFailure;
    /**
     * Abandon the effect and say so. Callers listening for `degraded` swap the raw
     * camera back in; this is the only route to that event, so both the watchdog
     * and a stuck segmenter reach it.
     */
    private giveUp;
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

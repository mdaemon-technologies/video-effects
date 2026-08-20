import type { WatchdogOptions } from "./types.js";
/**
 * Rolling frame-time monitor.
 *
 * In a 20-person room a client is already decoding 19 inbound streams, so
 * segmentation is the thing most likely to push a weak machine over the edge.
 * Rather than let the whole call degrade, we watch our own frame cost and give
 * up the effect if it is consistently too expensive.
 *
 * Tripping is deliberately one-way. Recovery would need hysteresis to avoid
 * flapping the effect on and off every few seconds, which reads as a bug to the
 * user; re-enabling is an explicit `setEffect` call instead.
 */
export default class FrameWatchdog {
    private readonly budget;
    private readonly windowSize;
    private readonly tripRatio;
    private samples;
    private cursor;
    private filled;
    private isTripped;
    constructor(options?: WatchdogOptions);
    get budgetMs(): number;
    get tripped(): boolean;
    /** Mean frame time over the samples collected so far; 0 before any sample. */
    get averageMs(): number;
    /**
     * Record one frame's processing time.
     *
     * @returns true when this sample caused the watchdog to trip. Returns false
     *   on every subsequent call, so callers can use it as an edge trigger.
     */
    record(ms: number): boolean;
    reset(): void;
}

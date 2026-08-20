import type { WatchdogOptions } from "./types.js";

const DEFAULT_BUDGET_MS = 22;
const DEFAULT_WINDOW_SIZE = 60;
const DEFAULT_TRIP_RATIO = 0.5;

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
  private readonly budget: number;
  private readonly windowSize: number;
  private readonly tripRatio: number;

  private samples: number[] = [];
  private cursor = 0;
  private filled = false;
  private isTripped = false;

  constructor(options: WatchdogOptions = {}) {
    const budget = options.budgetMs ?? DEFAULT_BUDGET_MS;
    const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
    const tripRatio = options.tripRatio ?? DEFAULT_TRIP_RATIO;

    if (!(budget > 0)) {
      throw new RangeError(`budgetMs must be greater than 0, received ${budget}`);
    }
    if (!Number.isInteger(windowSize) || windowSize < 1) {
      throw new RangeError(`windowSize must be a positive integer, received ${windowSize}`);
    }
    if (!(tripRatio > 0) || tripRatio > 1) {
      throw new RangeError(`tripRatio must be within (0, 1], received ${tripRatio}`);
    }

    this.budget = budget;
    this.windowSize = windowSize;
    this.tripRatio = tripRatio;
    this.samples = new Array<number>(windowSize).fill(0);
  }

  get budgetMs(): number {
    return this.budget;
  }

  get tripped(): boolean {
    return this.isTripped;
  }

  /** Mean frame time over the samples collected so far; 0 before any sample. */
  get averageMs(): number {
    const count = this.filled ? this.windowSize : this.cursor;
    if (count === 0) {
      return 0;
    }
    let total = 0;
    for (let i = 0; i < count; i += 1) {
      total += this.samples[i];
    }
    return total / count;
  }

  /**
   * Record one frame's processing time.
   *
   * @returns true when this sample caused the watchdog to trip. Returns false
   *   on every subsequent call, so callers can use it as an edge trigger.
   */
  record(ms: number): boolean {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError(`frame time must be a non-negative finite number, received ${ms}`);
    }
    if (this.isTripped) {
      return false;
    }

    this.samples[this.cursor] = ms;
    this.cursor += 1;
    if (this.cursor >= this.windowSize) {
      this.cursor = 0;
      this.filled = true;
    }

    // Only judge on a full window, or the first few slow frames while WASM is
    // still warming up would trip it immediately.
    if (!this.filled) {
      return false;
    }

    let over = 0;
    for (let i = 0; i < this.windowSize; i += 1) {
      if (this.samples[i] > this.budget) {
        over += 1;
      }
    }

    if (over / this.windowSize >= this.tripRatio) {
      this.isTripped = true;
      return true;
    }
    return false;
  }

  reset(): void {
    this.samples.fill(0);
    this.cursor = 0;
    this.filled = false;
    this.isTripped = false;
  }
}

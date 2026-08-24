/**
 * The two capture paths, driven end to end.
 *
 * jsdom has neither WebCodecs nor a canvas backend, so both paths are stood up
 * here out of hand-rolled parts: Node's web streams for the transform plumbing,
 * fake `MediaStreamTrackProcessor` / `MediaStreamTrackGenerator` constructors,
 * and the `documentRef` injection point for the canvases and the `<video>`.
 *
 * The fake segmenter enforces MediaPipe's real contract - VIDEO running mode
 * rejects a timestamp that does not strictly increase, and the graph stays
 * faulted afterwards - because that contract is exactly what this file exists
 * to pin. Neither capture path had any coverage before, which is how a raw
 * timestamp reached the segmenter unguarded.
 */
import { ReadableStream, TransformStream, WritableStream } from "node:stream/web";
import VideoEffects from "./videoEffects";
import type { DegradedEvent, VideoEffectsOptions } from "./types";
import type { VisionModule } from "./segmenter";

interface FakeFrame {
  displayWidth: number;
  displayHeight: number;
  timestamp: number;
  closed: boolean;
  close(): void;
}

const makeFrame = (timestamp: number): FakeFrame => ({
  displayWidth: 320,
  displayHeight: 180,
  timestamp,
  closed: false,
  close(): void {
    this.closed = true;
  }
});

/** Enqueue into the processor's readable; replaced on every new pipeline. */
let pushFrame: (frame: FakeFrame) => void = () => undefined;
/** Whatever the generator's writable received. */
let produced: Array<{ timestamp: number }> = [];
let generators: FakeGenerator[] = [];

class FakeProcessor {
  readable: ReadableStream<FakeFrame>;

  constructor(_init: { track: MediaStreamTrack }) {
    this.readable = new ReadableStream<FakeFrame>({
      start(controller) {
        pushFrame = (frame) => {
          try {
            controller.enqueue(frame);
          } catch {
            // The pipeline was torn down and the readable cancelled with it. A
            // real capture source drops frames the same way once its consumer
            // has detached, so this is the state under test, not an error.
          }
        };
      }
    });
  }
}

class FakeGenerator {
  kind = "video";
  contentHint = "";
  stopped = false;
  writable = new WritableStream<{ timestamp: number }>({
    write: (chunk) => {
      produced.push(chunk);
    }
  });

  constructor(_init: { kind: "video" }) {
    generators.push(this);
  }

  stop(): void {
    this.stopped = true;
  }
}

class FakeVideoFrame {
  timestamp: number;
  source: unknown;

  constructor(source: unknown, init: { timestamp: number }) {
    this.source = source;
    this.timestamp = init.timestamp;
  }

  close(): void {
    // Nothing to release in a fake.
  }
}

const fakeContext = (): unknown => ({
  globalCompositeOperation: "source-over",
  filter: "none",
  save: () => undefined,
  restore: () => undefined,
  clearRect: () => undefined,
  drawImage: () => undefined,
  createImageData: (w: number, h: number) => ({
    data: new Uint8ClampedArray(w * h * 4),
    width: w,
    height: h
  }),
  putImageData: () => undefined
});

const canvasTrack = (): MediaStreamTrack =>
  ({ kind: "video", contentHint: "", stop: jest.fn() }) as unknown as MediaStreamTrack;

const fakeDocument = (video?: unknown): Document => {
  const doc = {
    createElement: (tag: string) => {
      if (tag === "video") {
        return video ?? {};
      }
      const ctx = fakeContext();
      return {
        width: 0,
        height: 0,
        getContext: () => ctx,
        captureStream: () => ({ getVideoTracks: () => [canvasTrack()] })
      };
    }
  };
  return doc as unknown as Document;
};

const fakeTrack = (): MediaStreamTrack =>
  ({
    kind: "video",
    getSettings: () => ({ width: 320, height: 180 }),
    stop: jest.fn()
  }) as unknown as MediaStreamTrack;

interface SegmenterProbe {
  visionModule: VisionModule;
  /** Timestamps the graph accepted, in order. */
  accepted: number[];
  /** Every timestamp it was offered, accepted or not. */
  offered: number[];
  faulted: () => boolean;
  closes: () => number;
}

interface ProbeOptions {
  /** Fail every frame, standing in for a graph that is already broken. */
  alwaysThrow?: boolean;
  /** Withhold `createFromOptions` until this resolves. */
  gate?: Promise<void>;
}

const mediapipeLike = (options: ProbeOptions = {}): SegmenterProbe => {
  const accepted: number[] = [];
  const offered: number[] = [];
  let last = Number.NEGATIVE_INFINITY;
  let faulted = false;
  let closes = 0;

  const raw = {
    segmentForVideo(
      _input: CanvasImageSource,
      timestampMs: number,
      callback: (result: unknown) => void
    ): void {
      offered.push(timestampMs);
      if (options.alwaysThrow) {
        throw new Error("simulated segmentation failure");
      }
      if (faulted) {
        throw new Error("CalculatorGraph::Run() failed: the graph is in an error state");
      }
      if (timestampMs <= last) {
        // Worded like the real thing, in microseconds, because that is the
        // message the field report arrived with.
        faulted = true;
        throw new Error(
          "Packet timestamp mismatch on a calculator receiving from stream: expected " +
            `a minimum of ${Math.round(last * 1000) + 1}, received ${Math.round(timestampMs * 1000)}`
        );
      }
      last = timestampMs;
      accepted.push(timestampMs);
      callback({
        categoryMask: {
          getAsUint8Array: () => new Uint8Array(16),
          width: 4,
          height: 4,
          close: () => undefined
        }
      });
    },
    close(): void {
      closes += 1;
    }
  };

  return {
    accepted,
    offered,
    faulted: () => faulted,
    closes: () => closes,
    visionModule: {
      FilesetResolver: { forVisionTasks: async () => ({}) },
      ImageSegmenter: {
        createFromOptions: async () => {
          if (options.gate) {
            await options.gate;
          }
          return raw;
        }
      }
    } as unknown as VisionModule
  };
};

/** Let the stream pipeline pump; three macrotask turns is ample for one frame. */
const flush = async (turns = 3): Promise<void> => {
  for (let i = 0; i < turns; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const scope = globalThis as unknown as Record<string, unknown>;
const saved: Record<string, unknown> = {};

const stash = (key: string, value: unknown): void => {
  saved[key] = scope[key];
  scope[key] = value;
};

const installWebCodecs = (): void => {
  stash("ReadableStream", ReadableStream);
  stash("WritableStream", WritableStream);
  stash("TransformStream", TransformStream);
  stash("MediaStreamTrackProcessor", FakeProcessor);
  stash("MediaStreamTrackGenerator", FakeGenerator);
  stash("VideoFrame", FakeVideoFrame);
  stash(
    "MediaStream",
    class {
      constructor(public tracks: unknown[]) {}
    }
  );
};

const restoreGlobals = (): void => {
  for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) {
      delete scope[key];
    } else {
      scope[key] = saved[key];
    }
    delete saved[key];
  }
};

describe("WebCodecs path", () => {
  beforeEach(() => {
    installWebCodecs();
    pushFrame = () => undefined;
    produced = [];
    generators = [];
  });

  afterEach(() => {
    restoreGlobals();
    jest.restoreAllMocks();
  });

  const start = async (probe: SegmenterProbe, overrides: Partial<VideoEffectsOptions> = {}) => {
    const fx = new VideoEffects({
      assetBase: "/wasm",
      documentRef: fakeDocument(),
      watchdog: false,
      ...overrides
    });
    const errors: Error[] = [];
    const degraded: DegradedEvent[] = [];
    fx.on("error", (error) => errors.push(error));
    fx.on("degraded", (event) => degraded.push(event));
    await fx.setEffect({ type: "blur" });
    const track = fakeTrack();
    const output = await fx.process(track, { visionModule: probe.visionModule });
    return { fx, errors, degraded, track, output };
  };

  it("keeps publishing when the source repeats a frame timestamp", async () => {
    const probe = mediapipeLike();
    const { fx, errors, output, track } = await start(probe);
    expect(output).not.toBe(track);

    // 30fps in microseconds, with the third frame repeating the second's value -
    // the field failure exactly: "expected a minimum of ...101, received ...100".
    const frames = [0, 33333, 33333, 66666].map(makeFrame);
    for (const frame of frames) {
      pushFrame(frame);
      await flush();
    }

    // Every frame reached the far end. Before the guard the graph faulted on the
    // repeat and the pipeline enqueued nothing ever again: a live track carrying
    // a frozen picture.
    expect(produced).toHaveLength(4);
    expect(probe.faulted()).toBe(false);
    expect(errors).toEqual([]);

    // The segmenter saw strictly increasing milliseconds: the repeat was nudged
    // to the previous value plus one.
    expect(probe.accepted).toEqual([0, 33.333, 34.333, 66.666]);

    // The published frames keep the source's own timestamps, repeat included.
    // Only the segmenter's input is normalised, so output pacing is untouched.
    expect(produced.map((frame) => frame.timestamp)).toEqual([0, 33333, 33333, 66666]);

    fx.stop();
  });

  it("nudges a frozen clock forward rather than faulting the graph", async () => {
    const probe = mediapipeLike();
    const { fx, errors } = await start(probe);

    for (let i = 0; i < 5; i += 1) {
      pushFrame(makeFrame(1000));
      await flush();
    }

    expect(probe.accepted).toEqual([1, 2, 3, 4, 5]);
    expect(probe.faulted()).toBe(false);
    expect(produced).toHaveLength(5);
    expect(errors).toEqual([]);

    fx.stop();
  });

  it("publishes unmasked video through a failing segmenter, then gives up", async () => {
    const probe = mediapipeLike({ alwaysThrow: true });
    const { fx, errors, degraded } = await start(probe);

    const frames = Array.from({ length: 40 }, (_, i) => makeFrame(i * 33333));
    for (const frame of frames) {
      pushFrame(frame);
      await flush();
    }

    // A second of live, unmasked video rather than a frozen picture. The
    // thirtieth frame is composited but not published: it is the one that trips
    // the give-up, and tearing the pipeline down happens inside its render.
    expect(produced).toHaveLength(29);

    // One error for the streak, not one per frame: at 30fps a per-frame emit
    // would fire a consumer's handler thirty times a second, which is its own
    // outage.
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/simulated segmentation failure/);

    // And the give-up reaches `degraded`, which is the event consumers hang
    // their republish-the-camera recovery on. The watchdog could never reach it
    // here: it only ever sees frames that rendered.
    expect(degraded).toEqual([{ averageMs: 0, budgetMs: 0, reason: "segmentation" }]);
    expect(fx.degraded).toBe(true);
    expect(generators[0].stopped).toBe(true);

    // Exactly thirty frames reached the segmenter, and every one of them was
    // closed rather than leaked. The remaining ten never entered the pipeline:
    // tearing it down cancels the readable underneath the source.
    expect(probe.offered).toHaveLength(30);
    expect(frames.slice(0, 30).every((frame) => frame.closed)).toBe(true);
  });

  it("reports a watchdog trip as a budget failure", async () => {
    // Two calls per frame - start and end - ten milliseconds apart.
    let clock = 0;
    jest.spyOn(performance, "now").mockImplementation(() => {
      clock += 10;
      return clock;
    });

    const probe = mediapipeLike();
    const { fx, degraded } = await start(probe, {
      watchdog: { budgetMs: 1, windowSize: 2, tripRatio: 1 }
    });

    for (const ts of [0, 33333, 66666]) {
      pushFrame(makeFrame(ts));
      await flush();
    }

    expect(degraded).toHaveLength(1);
    expect(degraded[0].reason).toBe("budget");
    expect(degraded[0].budgetMs).toBe(1);
    expect(degraded[0].averageMs).toBe(10);
    expect(fx.degraded).toBe(true);
  });

  it("does not let a superseded process() clobber the pipeline that replaced it", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = mediapipeLike({ gate });
    const fast = mediapipeLike();

    const fx = new VideoEffects({
      assetBase: "/wasm",
      documentRef: fakeDocument(),
      watchdog: false,
      // Otherwise the first call parks on the native-blur probe instead of on
      // the gate, and bows out before it ever builds a segmenter - which would
      // pass this test without exercising the clobber it is about.
      preferNativeBlur: false
    });
    await fx.setEffect({ type: "blur" });
    const track = fakeTrack();

    // The re-apply case: a second process() lands while the first is still
    // waiting on MediaPipe to load.
    const first = fx.process(track, { visionModule: slow.visionModule });
    const secondOutput = await fx.process(track, { visionModule: fast.visionModule });
    release();
    const firstOutput = await first;

    // The superseded call bows out with the raw track and closes the segmenter
    // it built, rather than assigning over - and leaking - the live one.
    expect(firstOutput).toBe(track);
    expect(secondOutput).not.toBe(track);
    expect(slow.closes()).toBe(1);

    // Frames go to the winner's segmenter, and only the winner's.
    pushFrame(makeFrame(0));
    await flush();
    expect(fast.accepted).toEqual([0]);
    expect(slow.offered).toEqual([]);

    fx.stop();
  });
});

describe("canvas capture path", () => {
  let video: {
    srcObject: unknown;
    muted: boolean;
    playsInline: boolean;
    videoWidth: number;
    videoHeight: number;
    play: () => void;
    remove: () => void;
  };

  beforeEach(() => {
    // Only the canvas path is available here. Capability detection reads the
    // real prototype, so it is stubbed even though the compositor draws into a
    // fake canvas supplied through documentRef.
    stash("MediaStream", class {
      constructor(public tracks: unknown[]) {}
    });
    saved.__captureStream = (
      HTMLCanvasElement.prototype as unknown as Record<string, unknown>
    ).captureStream;
    (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).captureStream = () =>
      undefined;

    video = {
      srcObject: null,
      muted: false,
      playsInline: false,
      videoWidth: 320,
      videoHeight: 180,
      play: () => undefined,
      remove: () => undefined
    };
  });

  afterEach(() => {
    const original = saved.__captureStream;
    if (original === undefined) {
      delete (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).captureStream;
    } else {
      (HTMLCanvasElement.prototype as unknown as Record<string, unknown>).captureStream = original;
    }
    delete saved.__captureStream;
    restoreGlobals();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("survives a clock that stands still between frames", async () => {
    // requestVideoFrameCallback is absent here, so the path falls back to
    // setInterval and takes its timestamp from performance.now(). A clock
    // coarsened for fingerprinting defence repeats values at 30fps.
    jest.useFakeTimers();
    jest.spyOn(performance, "now").mockReturnValue(1234);

    const probe = mediapipeLike();
    const fx = new VideoEffects({
      assetBase: "/wasm",
      documentRef: fakeDocument(video),
      watchdog: false,
      targetFps: 30
    });
    const errors: Error[] = [];
    fx.on("error", (error) => errors.push(error));
    await fx.setEffect({ type: "blur" });

    const output = await fx.process(fakeTrack(), { visionModule: probe.visionModule });
    expect(output).toBeDefined();

    jest.advanceTimersByTime((1000 / 30) * 4 + 1);

    expect(probe.accepted).toEqual([1234, 1235, 1236, 1237]);
    expect(probe.faulted()).toBe(false);
    expect(errors).toEqual([]);

    fx.stop();
  });

  it("starts each pipeline from a fresh timestamp expectation", async () => {
    jest.useFakeTimers();
    let clock = 5000;
    jest.spyOn(performance, "now").mockImplementation(() => {
      clock += 100;
      return clock;
    });

    const first = mediapipeLike();
    const fx = new VideoEffects({
      assetBase: "/wasm",
      documentRef: fakeDocument(video),
      watchdog: false
    });
    await fx.setEffect({ type: "blur" });
    await fx.process(fakeTrack(), { visionModule: first.visionModule });
    jest.advanceTimersByTime(100);
    expect(first.accepted.length).toBeGreaterThan(0);

    // Rewind the clock behind the last timestamp the old graph accepted. A new
    // graph has no memory of the old one, so the raw value has to be usable
    // again rather than dragged forward by a stale high-water mark.
    const second = mediapipeLike();
    clock = 0;
    await fx.process(fakeTrack(), { visionModule: second.visionModule });
    jest.advanceTimersByTime(100);

    expect(second.accepted.length).toBeGreaterThan(0);
    expect(second.accepted[0]).toBeLessThan(first.accepted[0]);
    expect(second.faulted()).toBe(false);

    fx.stop();
  });
});

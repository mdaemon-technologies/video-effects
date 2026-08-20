import VideoEffects from "./videoEffects";
import { assertEffect } from "./effects";
import type { BackgroundEffect } from "./types";

/**
 * jsdom has neither WebCodecs nor canvas.captureStream, so detectCapabilities()
 * reports unsupported here. That is the interesting default: it exercises the
 * graceful-degradation path, which is exactly what a locked-down or ancient
 * browser will hit in production.
 */

interface FakeTrackOptions {
  kind?: string;
  blurCapable?: boolean;
  applyConstraintsFails?: boolean;
  settings?: MediaTrackSettings;
}

const fakeTrack = (options: FakeTrackOptions = {}): MediaStreamTrack => {
  const applied: Array<Record<string, unknown>> = [];
  const track = {
    kind: options.kind ?? "video",
    applied,
    getSettings: () => options.settings ?? { width: 1280, height: 720 },
    getCapabilities: options.blurCapable ? () => ({ backgroundBlur: [true, false] }) : undefined,
    applyConstraints: async (constraints: Record<string, unknown>) => {
      if (options.applyConstraintsFails) {
        throw new Error("OverconstrainedError");
      }
      applied.push(constraints);
    },
    stop: jest.fn()
  };
  return track as unknown as MediaStreamTrack;
};

const options = { assetBase: "/wasm" };

describe("VideoEffects construction", () => {
  it("refuses to construct without an assetBase", () => {
    expect(() => new VideoEffects({} as never)).toThrow(/assetBase/);
    expect(() => new VideoEffects(undefined as never)).toThrow(/assetBase/);
  });

  it("rejects a frame rate outside a sane range", () => {
    expect(() => new VideoEffects({ ...options, targetFps: 0 })).toThrow(RangeError);
    expect(() => new VideoEffects({ ...options, targetFps: -30 })).toThrow(RangeError);
    expect(() => new VideoEffects({ ...options, targetFps: 120 })).toThrow(RangeError);
  });

  it("accepts the boundary frame rates", () => {
    expect(() => new VideoEffects({ ...options, targetFps: 60 })).not.toThrow();
    expect(() => new VideoEffects({ ...options, targetFps: 1 })).not.toThrow();
  });

  it("starts with no effect and not degraded", () => {
    const fx = new VideoEffects(options);
    expect(fx.effect).toEqual({ type: "none" });
    expect(fx.degraded).toBe(false);
    expect(fx.usingHardwareBlur).toBe(false);
  });
});

describe("assertEffect", () => {
  it.each([
    ["none", { type: "none" }],
    ["blur without strength", { type: "blur" }],
    ["blur at the upper bound", { type: "blur", strength: 100 }],
    ["image from a url", { type: "image", source: "/backgrounds/office.jpg" }]
  ])("accepts %s", (_label, effect) => {
    expect(() => assertEffect(effect as BackgroundEffect)).not.toThrow();
  });

  it.each([
    ["null", null],
    ["a string", "blur"],
    ["an unknown type", { type: "cartoon" }],
    ["blur with zero strength", { type: "blur", strength: 0 }],
    ["blur with negative strength", { type: "blur", strength: -4 }],
    ["blur beyond the upper bound", { type: "blur", strength: 101 }],
    ["image with no source", { type: "image" }],
    ["image with an empty source", { type: "image", source: "" }]
  ])("rejects %s", (_label, effect) => {
    expect(() => assertEffect(effect as BackgroundEffect)).toThrow();
  });
});

describe("setEffect", () => {
  it("stores the effect and announces the change", async () => {
    const fx = new VideoEffects(options);
    const seen: BackgroundEffect[] = [];
    fx.on("effectchange", (effect) => seen.push(effect));

    await fx.setEffect({ type: "blur", strength: 8 });
    expect(fx.effect).toEqual({ type: "blur", strength: 8 });

    await fx.setEffect({ type: "none" });
    expect(fx.effect).toEqual({ type: "none" });
    expect(seen).toEqual([{ type: "blur", strength: 8 }, { type: "none" }]);
  });

  it("rejects an invalid effect without changing state or emitting", async () => {
    const fx = new VideoEffects(options);
    const listener = jest.fn();
    fx.on("effectchange", listener);
    await fx.setEffect({ type: "blur", strength: 10 });
    listener.mockClear();

    await expect(fx.setEffect({ type: "wat" } as never)).rejects.toThrow(TypeError);
    expect(fx.effect).toEqual({ type: "blur", strength: 10 });
    expect(listener).not.toHaveBeenCalled();
  });

  it("takes a pre-decoded bitmap without touching the network", async () => {
    const fx = new VideoEffects(options);
    const bitmap = { width: 1920, height: 1080 } as unknown as ImageBitmap;
    await expect(fx.setEffect({ type: "image", source: bitmap })).resolves.toBeUndefined();
    expect(fx.effect).toEqual({ type: "image", source: bitmap });
  });
});

describe("process", () => {
  it("rejects anything that is not a video track", async () => {
    const fx = new VideoEffects(options);
    await expect(fx.process(fakeTrack({ kind: "audio" }))).rejects.toThrow(TypeError);
    await expect(fx.process(null as never)).rejects.toThrow(TypeError);
  });

  it("passes the track straight through when no effect is set", async () => {
    const fx = new VideoEffects(options);
    const track = fakeTrack();
    await expect(fx.process(track)).resolves.toBe(track);
  });

  it("uses the hardware blur constraint when the camera advertises it", async () => {
    const fx = new VideoEffects(options);
    const track = fakeTrack({ blurCapable: true });
    await fx.setEffect({ type: "blur" });

    const output = await fx.process(track);

    expect(output).toBe(track);
    expect(fx.usingHardwareBlur).toBe(true);
    expect((track as unknown as { applied: unknown[] }).applied).toEqual([{ backgroundBlur: true }]);
  });

  it("turns the hardware blur back off when the effect is cleared", async () => {
    const fx = new VideoEffects(options);
    const track = fakeTrack({ blurCapable: true });
    await fx.setEffect({ type: "blur" });
    await fx.process(track);

    await fx.setEffect({ type: "none" });

    expect(fx.usingHardwareBlur).toBe(false);
    expect((track as unknown as { applied: unknown[] }).applied).toEqual([
      { backgroundBlur: true },
      { backgroundBlur: false }
    ]);
  });

  it("ignores hardware blur when the camera does not advertise it", async () => {
    const fx = new VideoEffects(options);
    const track = fakeTrack({ blurCapable: false });
    await fx.setEffect({ type: "blur" });

    await fx.process(track);

    expect(fx.usingHardwareBlur).toBe(false);
    expect((track as unknown as { applied: unknown[] }).applied).toEqual([]);
  });

  it("skips the hardware path entirely when preferNativeBlur is off", async () => {
    const fx = new VideoEffects({ ...options, preferNativeBlur: false });
    const track = fakeTrack({ blurCapable: true });
    await fx.setEffect({ type: "blur" });

    await fx.process(track);

    expect(fx.usingHardwareBlur).toBe(false);
    expect((track as unknown as { applied: unknown[] }).applied).toEqual([]);
  });

  it("reports an error and returns the raw track when no capture path exists", async () => {
    const fx = new VideoEffects(options);
    const errors: Error[] = [];
    fx.on("error", (error) => errors.push(error));
    const track = fakeTrack();
    await fx.setEffect({ type: "blur" });

    const output = await fx.process(track);

    // Degrading to unprocessed video is correct here: a call without a blurred
    // background beats no call at all.
    expect(output).toBe(track);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/capture path/i);
  });
});

describe("lifecycle", () => {
  it("is safe to stop before anything was ever started", () => {
    const fx = new VideoEffects(options);
    expect(() => fx.stop()).not.toThrow();
    expect(() => fx.stop()).not.toThrow();
  });

  it("drops listeners on destroy", async () => {
    const fx = new VideoEffects(options);
    const listener = jest.fn();
    fx.on("effectchange", listener);

    fx.destroy();
    await fx.setEffect({ type: "blur" });

    expect(listener).not.toHaveBeenCalled();
    expect(fx.usingHardwareBlur).toBe(false);
  });
});

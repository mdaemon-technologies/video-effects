import { coverRect, imageSourceSize } from "./compositor";

describe("coverRect", () => {
  it("fills exactly with no offset when the aspect ratios match", () => {
    expect(coverRect(1280, 720, 640, 360)).toEqual({ x: 0, y: 0, width: 640, height: 360 });
  });

  it("overflows horizontally when the image is wider than the frame", () => {
    // 16:9 background into a 4:3 frame: height drives the scale, sides spill.
    const rect = coverRect(1600, 900, 800, 600);
    expect(rect.height).toBe(600);
    expect(rect.width).toBeCloseTo(1066.667, 3);
    expect(rect.y).toBe(0);
    // Centred, so the overflow is split evenly and x goes negative.
    expect(rect.x).toBeCloseTo(-133.333, 3);
    expect(rect.x * 2 + rect.width).toBeCloseTo(800, 6);
  });

  it("overflows vertically when the image is taller than the frame", () => {
    // Portrait phone photo used as a background on a landscape camera.
    const rect = coverRect(1080, 1920, 1280, 720);
    expect(rect.width).toBe(1280);
    expect(rect.height).toBeCloseTo(2275.556, 3);
    expect(rect.x).toBe(0);
    expect(rect.y * 2 + rect.height).toBeCloseTo(720, 6);
  });

  it("never leaves a gap: the rect always covers the whole frame", () => {
    const cases: Array<[number, number]> = [
      [4000, 3000],
      [800, 800],
      [640, 480],
      [3840, 1080],
      [200, 1000]
    ];
    for (const [sw, sh] of cases) {
      const rect = coverRect(sw, sh, 1280, 720);
      expect(rect.x).toBeLessThanOrEqual(0.000001);
      expect(rect.y).toBeLessThanOrEqual(0.000001);
      expect(rect.x + rect.width).toBeGreaterThanOrEqual(1280 - 0.000001);
      expect(rect.y + rect.height).toBeGreaterThanOrEqual(720 - 0.000001);
    }
  });

  it("preserves the source aspect ratio", () => {
    const rect = coverRect(1600, 900, 800, 600);
    expect(rect.width / rect.height).toBeCloseTo(1600 / 900, 6);
  });

  it("scales up a background smaller than the frame", () => {
    const rect = coverRect(320, 180, 1280, 720);
    expect(rect.width).toBe(1280);
    expect(rect.height).toBe(720);
  });

  describe("rejects degenerate dimensions", () => {
    it.each([
      ["zero source width", [0, 100, 10, 10]],
      ["zero destination height", [100, 100, 10, 0]],
      ["negative source height", [100, -1, 10, 10]],
      ["NaN destination width", [100, 100, Number.NaN, 10]]
    ])("%s", (_label, args) => {
      const [sw, sh, dw, dh] = args as number[];
      expect(() => coverRect(sw, sh, dw, dh)).toThrow(RangeError);
    });
  });
});

describe("imageSourceSize", () => {
  it("prefers intrinsic video dimensions over element layout size", () => {
    const video = { width: 300, height: 150, videoWidth: 1280, videoHeight: 720 };
    expect(imageSourceSize(video as unknown as CanvasImageSource)).toEqual({
      width: 1280,
      height: 720
    });
  });

  it("uses width/height for an ImageBitmap-shaped source", () => {
    const bitmap = { width: 1920, height: 1080 };
    expect(imageSourceSize(bitmap as unknown as CanvasImageSource)).toEqual({
      width: 1920,
      height: 1080
    });
  });

  it("ignores a zero videoWidth from a video element that has not loaded yet", () => {
    const video = { width: 640, height: 480, videoWidth: 0, videoHeight: 0 };
    expect(imageSourceSize(video as unknown as CanvasImageSource)).toEqual({
      width: 640,
      height: 480
    });
  });
});

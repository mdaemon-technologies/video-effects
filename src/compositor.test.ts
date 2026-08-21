import Compositor, { coverRect, imageSourceSize } from "./compositor";

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

/**
 * jsdom has no canvas backend, so the compositor is driven through its
 * `documentRef` injection point against hand-rolled canvases that record what
 * was drawn. That is enough to pin the one thing the real canvas would
 * otherwise hide: which side of the mask the subject is on.
 */
interface Probe {
  calls: Array<{ op: string; image: unknown; filter: string }>;
  puts: Array<{ data: Uint8ClampedArray; width: number; height: number }>;
}

interface ProbeCanvas {
  width: number;
  height: number;
  probe: Probe;
  getContext: () => unknown;
}

const fakeCanvas = (): ProbeCanvas => {
  const probe: Probe = { calls: [], puts: [] };
  const ctx = {
    globalCompositeOperation: "source-over",
    filter: "none",
    save: () => undefined,
    restore: () => undefined,
    clearRect: () => undefined,
    drawImage: (image: unknown) => {
      probe.calls.push({ op: ctx.globalCompositeOperation, image, filter: ctx.filter });
    },
    createImageData: (w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h
    }),
    putImageData: (image: { data: Uint8ClampedArray; width: number; height: number }) => {
      // Copy: the compositor reuses one ImageData across frames.
      probe.puts.push({ data: image.data.slice(), width: image.width, height: image.height });
    }
  };
  return { width: 0, height: 0, probe, getContext: () => ctx };
};

const fakeDocument = () => {
  const canvases: ProbeCanvas[] = [];
  const doc = {
    createElement: () => {
      const canvas = fakeCanvas();
      canvases.push(canvas);
      return canvas;
    }
  };
  return { doc: doc as unknown as Document, canvases };
};

const alphaOf = (put: { data: Uint8ClampedArray }): number[] => {
  const alpha: number[] = [];
  for (let p = 3; p < put.data.length; p += 4) {
    alpha.push(put.data[p]);
  }
  return alpha;
};

// 0 is the person; 1 is the room behind them.
const MASK = { data: new Uint8Array([0, 1, 1, 0, 0, 1, 1, 0]), width: 4, height: 2 };
const SOURCE = { width: 4, height: 2 } as unknown as CanvasImageSource;

describe("Compositor mask polarity", () => {
  const setup = () => {
    const { doc, canvases } = fakeDocument();
    const compositor = new Compositor(4, 2, doc);
    return { compositor, output: canvases[0], maskCanvas: canvases[1] };
  };

  it("makes the mask opaque over the person and transparent over the background", () => {
    const { compositor, maskCanvas } = setup();
    compositor.render(SOURCE, MASK, { type: "blur", strength: 8 }, null);

    // The alpha channel is the clip: 255 keeps the camera pixel, 0 lets the
    // replacement background through. Inverting this is the bug that paints the
    // background over the subject.
    expect(alphaOf(maskCanvas.probe.puts[0])).toEqual([255, 0, 0, 255, 255, 0, 0, 255]);
  });

  it("clips the camera to the person, then paints the background behind it", () => {
    const { compositor, output, maskCanvas } = setup();
    compositor.render(SOURCE, MASK, { type: "blur", strength: 8 }, null);

    const calls = output.probe.calls;
    expect(calls.map((c) => c.op)).toEqual(["source-over", "destination-in", "destination-over"]);
    expect(calls[0].image).toBe(SOURCE);
    expect(calls[1].image).toBe(maskCanvas);
    expect(calls[2].image).toBe(SOURCE);
    expect(calls[2].filter).toBe("blur(8px)");
  });

  it("draws a background image behind the person rather than over them", () => {
    const { compositor, output } = setup();
    const background = { width: 8, height: 4 } as unknown as CanvasImageSource;
    compositor.render(SOURCE, MASK, { type: "image", source: "https://example.test/bg.png" }, background);

    const last = output.probe.calls[output.probe.calls.length - 1];
    expect(last.op).toBe("destination-over");
    expect(last.image).toBe(background);
  });

  it("leaves the frame untouched when there is no mask", () => {
    const { compositor, output, maskCanvas } = setup();
    compositor.render(SOURCE, null, { type: "blur" }, null);

    expect(output.probe.calls.map((c) => c.op)).toEqual(["source-over"]);
    expect(maskCanvas.probe.puts).toHaveLength(0);
  });

  it("rejects a mask smaller than its stated dimensions", () => {
    const { compositor } = setup();
    const short = { data: new Uint8Array(3), width: 4, height: 2 };
    expect(() => compositor.render(SOURCE, short, { type: "blur" }, null)).toThrow(RangeError);
  });
});

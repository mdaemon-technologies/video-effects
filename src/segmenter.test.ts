import SelfieSegmenter, { resolveVisionModule } from "./segmenter";
import type { VisionModule, RawSegmenter, RawSegmenterResult } from "./segmenter";

const makeMask = (values: number[], width: number, height: number) => ({
  getAsUint8Array: () => Uint8Array.from(values),
  width,
  height,
  close: jest.fn()
});

interface StubOptions {
  mask?: ReturnType<typeof makeMask> | null;
  onCreate?: (fileset: unknown, options: Record<string, unknown>) => void;
}

const stubVision = (options: StubOptions = {}) => {
  const segmenter: RawSegmenter = {
    segmentForVideo: (_input, _timestamp, callback: (result: RawSegmenterResult) => void) => {
      callback({ categoryMask: options.mask ?? undefined });
    },
    close: jest.fn()
  };
  const module: VisionModule = {
    FilesetResolver: {
      forVisionTasks: jest.fn(async (basePath: string) => ({ basePath }))
    },
    ImageSegmenter: {
      createFromOptions: jest.fn(async (fileset: unknown, opts: Record<string, unknown>) => {
        options.onCreate?.(fileset, opts);
        return segmenter;
      })
    }
  };
  return { module, segmenter };
};

describe("resolveVisionModule", () => {
  it("prefers an explicitly injected module", async () => {
    const { module } = stubVision();
    await expect(resolveVisionModule(module)).resolves.toBe(module);
  });

  it("falls back to a global published by a script tag", async () => {
    const { module } = stubVision();
    await expect(resolveVisionModule(undefined, { mediapipeVision: module })).resolves.toBe(module);
  });

  it("ignores a half-shaped global and falls through to the import", async () => {
    // A partial global must not be mistaken for the real thing, or the failure
    // surfaces later as an opaque "not a function".
    const { module } = stubVision();
    const importer = jest.fn(async () => module);

    const resolved = await resolveVisionModule(
      undefined,
      { mediapipeVision: { FilesetResolver: {} } },
      importer
    );

    expect(importer).toHaveBeenCalled();
    expect(resolved).toBe(module);
  });

  it("falls back to the dynamic import when there is no global", async () => {
    const { module } = stubVision();
    const importer = jest.fn(async () => module);
    await expect(resolveVisionModule(undefined, {}, importer)).resolves.toBe(module);
  });

  it("explains how to fix a missing peer dependency", async () => {
    const importer = jest.fn(async () => {
      throw new Error("Cannot find module '@mediapipe/tasks-vision'");
    });
    await expect(resolveVisionModule(undefined, {}, importer)).rejects.toThrow(
      /Install it alongside @mdaemon\/video-effects/
    );
  });

  it("preserves the underlying import failure as the error cause", async () => {
    const underlying = new Error("network error fetching chunk");
    const importer = jest.fn(async () => {
      throw underlying;
    });
    await expect(resolveVisionModule(undefined, {}, importer)).rejects.toMatchObject({
      cause: underlying
    });
  });

  it("resolves the real package when it is actually installed", async () => {
    // The package is a devDependency here, so the unstubbed path must work.
    const resolved = await resolveVisionModule();
    expect(typeof resolved.FilesetResolver.forVisionTasks).toBe("function");
    expect(typeof resolved.ImageSegmenter.createFromOptions).toBe("function");
  });
});

describe("SelfieSegmenter", () => {
  it("requires an assetBase", async () => {
    await expect(SelfieSegmenter.create({ assetBase: "" })).rejects.toThrow(/assetBase/);
  });

  it("derives the default model path from the asset base", async () => {
    const seen: Record<string, unknown>[] = [];
    const { module } = stubVision({ onCreate: (_f, opts) => seen.push(opts) });

    await SelfieSegmenter.create({ assetBase: "/wasm", visionModule: module });

    expect(module.FilesetResolver.forVisionTasks).toHaveBeenCalledWith("/wasm");
    const baseOptions = seen[0].baseOptions as Record<string, unknown>;
    expect(baseOptions.modelAssetPath).toBe("/wasm/selfie_segmenter_landscape.tflite");
    expect(baseOptions.delegate).toBe("GPU");
    expect(seen[0].runningMode).toBe("VIDEO");
    expect(seen[0].outputCategoryMask).toBe(true);
  });

  it("does not double up slashes when the asset base has a trailing one", async () => {
    const seen: Record<string, unknown>[] = [];
    const { module } = stubVision({ onCreate: (_f, opts) => seen.push(opts) });

    await SelfieSegmenter.create({ assetBase: "/wasm/", visionModule: module });

    const baseOptions = seen[0].baseOptions as Record<string, unknown>;
    expect(baseOptions.modelAssetPath).toBe("/wasm/selfie_segmenter_landscape.tflite");
  });

  it("honours an explicit model path", async () => {
    const seen: Record<string, unknown>[] = [];
    const { module } = stubVision({ onCreate: (_f, opts) => seen.push(opts) });

    await SelfieSegmenter.create({
      assetBase: "/wasm",
      modelAssetPath: "https://cdn.example/custom.tflite",
      visionModule: module
    });

    const baseOptions = seen[0].baseOptions as Record<string, unknown>;
    expect(baseOptions.modelAssetPath).toBe("https://cdn.example/custom.tflite");
  });

  it("copies the mask out before MediaPipe reclaims it", async () => {
    const mask = makeMask([0, 255, 255, 0], 2, 2);
    const { module } = stubVision({ mask });
    const segmenter = await SelfieSegmenter.create({ assetBase: "/wasm", visionModule: module });

    const result = segmenter.segment({} as CanvasImageSource, 1000);

    expect(result).toEqual({ data: Uint8Array.from([0, 255, 255, 0]), width: 2, height: 2 });
    // The copy must survive MediaPipe closing the underlying buffer.
    expect(mask.close).toHaveBeenCalled();
  });

  it("returns null when a frame yields no mask", async () => {
    const { module } = stubVision({ mask: null });
    const segmenter = await SelfieSegmenter.create({ assetBase: "/wasm", visionModule: module });
    expect(segmenter.segment({} as CanvasImageSource, 0)).toBeNull();
  });

  it("releases the native segmenter on close and refuses further work", async () => {
    const { module, segmenter: raw } = stubVision({ mask: makeMask([255], 1, 1) });
    const segmenter = await SelfieSegmenter.create({ assetBase: "/wasm", visionModule: module });

    segmenter.close();

    expect(raw.close).toHaveBeenCalled();
    expect(() => segmenter.segment({} as CanvasImageSource, 0)).toThrow(/closed/);
  });
});

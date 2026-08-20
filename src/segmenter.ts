/**
 * Thin wrapper over MediaPipe's `ImageSegmenter`.
 *
 * The MediaPipe runtime is a peer dependency and is never bundled: it is
 * resolved lazily, and only the first time a segmentation-backed effect is
 * switched on. A user who only ever uses the browser's native blur — or who
 * never turns an effect on at all — never downloads it.
 */

export interface MaskResult {
  data: Uint8Array;
  width: number;
  height: number;
}

/** The slice of `@mediapipe/tasks-vision` this package actually uses. */
export interface VisionModule {
  FilesetResolver: {
    forVisionTasks(basePath: string): Promise<unknown>;
  };
  ImageSegmenter: {
    createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<RawSegmenter>;
  };
}

export interface RawSegmenter {
  segmentForVideo(
    input: CanvasImageSource,
    timestampMs: number,
    callback: (result: RawSegmenterResult) => void
  ): void;
  close(): void;
}

export interface RawSegmenterResult {
  categoryMask?: {
    getAsUint8Array(): Uint8Array;
    width: number;
    height: number;
    close?: () => void;
  };
  close?: () => void;
}

export interface SegmenterInit {
  assetBase: string;
  modelAssetPath?: string;
  /**
   * Pre-resolved MediaPipe module. Supply this when the runtime arrives by
   * `<script>` tag rather than through a bundler — RTCServer's plain-JS client
   * does exactly that.
   */
  visionModule?: VisionModule;
}

const DEFAULT_MODEL = "selfie_segmenter_landscape.tflite";

function joinUrl(base: string, file: string): string {
  return `${base.replace(/\/+$/, "")}/${file.replace(/^\/+/, "")}`;
}

/** Dynamic import of the peer dependency; injectable so it can be tested. */
export type VisionImporter = () => Promise<unknown>;

const defaultImporter: VisionImporter = () => import("@mediapipe/tasks-vision");

/**
 * Resolution order: explicitly injected module, then a global published by a
 * script tag, then a bundler-resolved dynamic import.
 */
export async function resolveVisionModule(
  injected?: VisionModule,
  scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
  importer: VisionImporter = defaultImporter
): Promise<VisionModule> {
  if (injected) {
    return injected;
  }
  const fromGlobal = scope.mediapipeVision as VisionModule | undefined;
  if (fromGlobal?.FilesetResolver && fromGlobal?.ImageSegmenter) {
    return fromGlobal;
  }
  try {
    return (await importer()) as VisionModule;
  } catch (cause) {
    throw new Error(
      "@mediapipe/tasks-vision could not be loaded. Install it alongside " +
        "@mdaemon/video-effects, or pass a resolved module as `visionModule`.",
      { cause }
    );
  }
}

export default class SelfieSegmenter {
  private segmenter: RawSegmenter | null = null;

  private constructor(segmenter: RawSegmenter) {
    this.segmenter = segmenter;
  }

  static async create(init: SegmenterInit): Promise<SelfieSegmenter> {
    if (!init.assetBase) {
      throw new Error("assetBase is required: the MediaPipe WASM artifacts must be served somewhere");
    }
    const vision = await resolveVisionModule(init.visionModule);
    const fileset = await vision.FilesetResolver.forVisionTasks(init.assetBase);
    const segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: init.modelAssetPath ?? joinUrl(init.assetBase, DEFAULT_MODEL),
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      outputCategoryMask: true,
      outputConfidenceMasks: false
    });
    return new SelfieSegmenter(segmenter);
  }

  /**
   * Segment one frame.
   *
   * MediaPipe hands the mask back through a callback that it invokes
   * synchronously and then invalidates, so the bytes are copied out before the
   * callback returns.
   */
  segment(frame: CanvasImageSource, timestampMs: number): MaskResult | null {
    if (!this.segmenter) {
      throw new Error("segmenter has been closed");
    }
    let mask: MaskResult | null = null;
    this.segmenter.segmentForVideo(frame, timestampMs, (result) => {
      const categoryMask = result.categoryMask;
      if (!categoryMask) {
        return;
      }
      mask = {
        data: new Uint8Array(categoryMask.getAsUint8Array()),
        width: categoryMask.width,
        height: categoryMask.height
      };
      categoryMask.close?.();
    });
    return mask;
  }

  close(): void {
    this.segmenter?.close();
    this.segmenter = null;
  }
}

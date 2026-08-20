import type { BackgroundEffect } from "./types.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Scale `src` to fill `dst` entirely while preserving aspect ratio, centring the
 * overflow — the `background-size: cover` rule, in numbers.
 *
 * Background images are almost never the same aspect as the camera, and
 * stretching them is the single most obvious way to make the feature look
 * cheap.
 */
export function coverRect(srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): Rect {
  if (!(srcWidth > 0) || !(srcHeight > 0) || !(dstWidth > 0) || !(dstHeight > 0)) {
    throw new RangeError("coverRect requires positive, finite dimensions");
  }
  const scale = Math.max(dstWidth / srcWidth, dstHeight / srcHeight);
  const width = srcWidth * scale;
  const height = srcHeight * scale;
  return {
    x: (dstWidth - width) / 2,
    y: (dstHeight - height) / 2,
    width,
    height
  };
}

const DEFAULT_BLUR_STRENGTH = 12;

/**
 * Composites a segmentation mask over a camera frame using 2D canvas
 * operations.
 *
 * A WebGL implementation would shave a millisecond or two, but the 2D path is a
 * fraction of the code, is accelerated everywhere we care about, and gets
 * bilinear mask smoothing for free by drawing the low-resolution mask scaled up.
 */
export default class Compositor {
  private readonly output: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly maskCanvas: HTMLCanvasElement;
  private readonly maskCtx: CanvasRenderingContext2D;
  private maskImage: ImageData | null = null;

  constructor(width: number, height: number, documentRef: Document = document) {
    this.output = documentRef.createElement("canvas");
    this.maskCanvas = documentRef.createElement("canvas");

    const ctx = this.output.getContext("2d", { alpha: true, desynchronized: true });
    const maskCtx = this.maskCanvas.getContext("2d", { alpha: true, willReadFrequently: true });
    if (!ctx || !maskCtx) {
      throw new Error("2D canvas context is unavailable; cannot composite video effects");
    }
    this.ctx = ctx;
    this.maskCtx = maskCtx;
    this.resize(width, height);
  }

  get canvas(): HTMLCanvasElement {
    return this.output;
  }

  get width(): number {
    return this.output.width;
  }

  get height(): number {
    return this.output.height;
  }

  resize(width: number, height: number): void {
    if (!(width > 0) || !(height > 0)) {
      throw new RangeError(`compositor dimensions must be positive, received ${width}x${height}`);
    }
    if (this.output.width !== width || this.output.height !== height) {
      this.output.width = width;
      this.output.height = height;
    }
  }

  /**
   * Turn MediaPipe's per-pixel category mask into an alpha channel we can use
   * as a clipping source. Values are treated as "non-zero means foreground",
   * which holds for both the binary category mask and a confidence mask.
   */
  private writeMask(mask: Uint8Array, maskWidth: number, maskHeight: number): void {
    if (mask.length < maskWidth * maskHeight) {
      throw new RangeError(
        `mask of ${mask.length} bytes is too small for ${maskWidth}x${maskHeight}`
      );
    }
    if (this.maskCanvas.width !== maskWidth || this.maskCanvas.height !== maskHeight) {
      this.maskCanvas.width = maskWidth;
      this.maskCanvas.height = maskHeight;
      this.maskImage = null;
    }
    if (!this.maskImage) {
      this.maskImage = this.maskCtx.createImageData(maskWidth, maskHeight);
    }

    const pixels = this.maskImage.data;
    for (let i = 0, p = 0; i < maskWidth * maskHeight; i += 1, p += 4) {
      const value = mask[i] === 0 ? 0 : 255;
      pixels[p] = 255;
      pixels[p + 1] = 255;
      pixels[p + 2] = 255;
      pixels[p + 3] = value;
    }
    this.maskCtx.putImageData(this.maskImage, 0, 0);
  }

  /**
   * Draw one composited frame.
   *
   * @param source the raw camera frame
   * @param mask foreground mask, or null to draw the frame untouched
   * @param effect the background treatment to apply behind the mask
   * @param background decoded image for `{ type: "image" }` effects
   */
  render(
    source: CanvasImageSource,
    mask: { data: Uint8Array; width: number; height: number } | null,
    effect: BackgroundEffect,
    background: CanvasImageSource | null
  ): void {
    const { width, height } = this;
    this.ctx.save();
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.filter = "none";
    this.ctx.drawImage(source, 0, 0, width, height);

    if (!mask || effect.type === "none") {
      this.ctx.restore();
      return;
    }

    // Keep only the pixels the mask marks as foreground.
    this.writeMask(mask.data, mask.width, mask.height);
    this.ctx.globalCompositeOperation = "destination-in";
    this.ctx.drawImage(this.maskCanvas, 0, 0, width, height);

    // Then paint the replacement background behind what survived.
    this.ctx.globalCompositeOperation = "destination-over";
    if (effect.type === "blur") {
      const strength = effect.strength ?? DEFAULT_BLUR_STRENGTH;
      this.ctx.filter = `blur(${strength}px)`;
      this.ctx.drawImage(source, 0, 0, width, height);
      this.ctx.filter = "none";
    } else if (effect.type === "image" && background) {
      const dims = imageSourceSize(background);
      const rect = coverRect(dims.width, dims.height, width, height);
      this.ctx.drawImage(background, rect.x, rect.y, rect.width, rect.height);
    } else {
      // An image effect whose bitmap failed to decode: fall back to blur rather
      // than punching a transparent hole where the background should be.
      this.ctx.filter = `blur(${DEFAULT_BLUR_STRENGTH}px)`;
      this.ctx.drawImage(source, 0, 0, width, height);
      this.ctx.filter = "none";
    }

    this.ctx.restore();
  }
}

export function imageSourceSize(source: CanvasImageSource): { width: number; height: number } {
  const candidate = source as { width?: unknown; height?: unknown; videoWidth?: number; videoHeight?: number };
  if (typeof candidate.videoWidth === "number" && candidate.videoWidth > 0) {
    return { width: candidate.videoWidth, height: candidate.videoHeight ?? 0 };
  }
  const width = typeof candidate.width === "number" ? candidate.width : 0;
  const height = typeof candidate.height === "number" ? candidate.height : 0;
  return { width, height };
}

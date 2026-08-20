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
export declare function coverRect(srcWidth: number, srcHeight: number, dstWidth: number, dstHeight: number): Rect;
/**
 * Composites a segmentation mask over a camera frame using 2D canvas
 * operations.
 *
 * A WebGL implementation would shave a millisecond or two, but the 2D path is a
 * fraction of the code, is accelerated everywhere we care about, and gets
 * bilinear mask smoothing for free by drawing the low-resolution mask scaled up.
 */
export default class Compositor {
    private readonly output;
    private readonly ctx;
    private readonly maskCanvas;
    private readonly maskCtx;
    private maskImage;
    constructor(width: number, height: number, documentRef?: Document);
    get canvas(): HTMLCanvasElement;
    get width(): number;
    get height(): number;
    resize(width: number, height: number): void;
    /**
     * Turn MediaPipe's per-pixel category mask into an alpha channel we can use
     * as a clipping source. Values are treated as "non-zero means foreground",
     * which holds for both the binary category mask and a confidence mask.
     */
    private writeMask;
    /**
     * Draw one composited frame.
     *
     * @param source the raw camera frame
     * @param mask foreground mask, or null to draw the frame untouched
     * @param effect the background treatment to apply behind the mask
     * @param background decoded image for `{ type: "image" }` effects
     */
    render(source: CanvasImageSource, mask: {
        data: Uint8Array;
        width: number;
        height: number;
    } | null, effect: BackgroundEffect, background: CanvasImageSource | null): void;
}
export declare function imageSourceSize(source: CanvasImageSource): {
    width: number;
    height: number;
};

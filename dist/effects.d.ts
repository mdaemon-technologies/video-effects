import type { BackgroundEffect } from "./types.js";
/**
 * Validate an effect before it is stored, so a bad value fails at the call site
 * rather than as a broken frame thirty seconds into a conference.
 */
export declare function assertEffect(effect: BackgroundEffect): void;
/**
 * Turn an effect source into something drawable. A URL costs a fetch and a
 * decode on first use; an already-decoded bitmap is passed straight through.
 */
export declare function decodeBackground(source: string | ImageBitmap | HTMLImageElement): Promise<CanvasImageSource>;

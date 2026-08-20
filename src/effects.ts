import type { BackgroundEffect } from "./types.js";

/**
 * Validate an effect before it is stored, so a bad value fails at the call site
 * rather than as a broken frame thirty seconds into a conference.
 */
export function assertEffect(effect: BackgroundEffect): void {
  if (!effect || typeof effect !== "object") {
    throw new TypeError("effect must be an object");
  }
  switch (effect.type) {
    case "none":
      return;
    case "blur":
      if (effect.strength !== undefined && (!(effect.strength > 0) || effect.strength > 100)) {
        throw new RangeError(`blur strength must be within (0, 100], received ${effect.strength}`);
      }
      return;
    case "image":
      if (!effect.source) {
        throw new TypeError("image effect requires a source");
      }
      return;
    default:
      throw new TypeError(`unknown effect type "${(effect as { type: string }).type}"`);
  }
}

/**
 * Turn an effect source into something drawable. A URL costs a fetch and a
 * decode on first use; an already-decoded bitmap is passed straight through.
 */
export async function decodeBackground(
  source: string | ImageBitmap | HTMLImageElement
): Promise<CanvasImageSource> {
  if (typeof source !== "string") {
    return source;
  }
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`failed to load background image "${source}": ${response.status}`);
  }
  return createImageBitmap(await response.blob());
}

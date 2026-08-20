import type { BlurCapableTrack } from "./domExtras.js";

/**
 * Ask the platform to blur the background in hardware.
 *
 * Chromium 114+ on supported hardware exposes `backgroundBlur` as a real
 * MediaTrackConstraint. When it works it costs us nothing at all — no WASM
 * download, no per-frame work, no extra encode — so it is always worth trying
 * before falling back to segmentation.
 *
 * It is blur-only: there is no platform equivalent for replacing the background
 * with an image.
 *
 * @returns true when the constraint was accepted and is now in the requested state.
 */
export async function applyNativeBackgroundBlur(
  track: MediaStreamTrack,
  enabled: boolean
): Promise<boolean> {
  const candidate = track as unknown as BlurCapableTrack;
  if (typeof candidate.applyConstraints !== "function") {
    return false;
  }

  // getCapabilities is the only reliable signal — support is gated on the
  // camera and OS, not just the browser build.
  const capabilities = candidate.getCapabilities?.();
  const supported = capabilities?.backgroundBlur;
  if (!Array.isArray(supported) || !supported.includes(enabled)) {
    return false;
  }

  try {
    await candidate.applyConstraints({ backgroundBlur: enabled });
    return true;
  } catch {
    // OverconstrainedError, or the user revoked it at OS level mid-call.
    return false;
  }
}

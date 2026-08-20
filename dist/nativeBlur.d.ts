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
export declare function applyNativeBackgroundBlur(track: MediaStreamTrack, enabled: boolean): Promise<boolean>;

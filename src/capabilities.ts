import type { Capabilities } from "./types.js";

/**
 * The bits of the platform we probe for. Injectable so the detection logic is
 * testable without a real browser.
 */
export interface DetectionScope {
  MediaStreamTrackProcessor?: unknown;
  MediaStreamTrackGenerator?: unknown;
  HTMLCanvasElement?: { prototype?: { captureStream?: unknown } };
  navigator?: {
    mediaDevices?: {
      getSupportedConstraints?: () => Record<string, unknown>;
    };
  };
}

/**
 * `backgroundBlur` is a real MediaTrackConstraint in Chromium 114+ but is not
 * in the TypeScript DOM lib, and is gated on OS/hardware support rather than
 * just browser version — so it has to be probed, never assumed from UA.
 */
export function supportsNativeBackgroundBlur(scope: DetectionScope = globalThis as unknown as DetectionScope): boolean {
  const getSupported = scope?.navigator?.mediaDevices?.getSupportedConstraints;
  if (typeof getSupported !== "function") {
    return false;
  }
  try {
    return getSupported.call(scope.navigator!.mediaDevices)?.backgroundBlur === true;
  } catch {
    return false;
  }
}

export function detectCapabilities(scope: DetectionScope = globalThis as unknown as DetectionScope): Capabilities {
  const insertableStreams =
    typeof scope?.MediaStreamTrackProcessor === "function" &&
    typeof scope?.MediaStreamTrackGenerator === "function";

  const captureStream = typeof scope?.HTMLCanvasElement?.prototype?.captureStream === "function";

  return {
    insertableStreams,
    captureStream,
    nativeBackgroundBlur: supportsNativeBackgroundBlur(scope),
    supported: insertableStreams || captureStream
  };
}

import type { Capabilities } from "./types.js";
/**
 * The bits of the platform we probe for. Injectable so the detection logic is
 * testable without a real browser.
 */
export interface DetectionScope {
    MediaStreamTrackProcessor?: unknown;
    MediaStreamTrackGenerator?: unknown;
    HTMLCanvasElement?: {
        prototype?: {
            captureStream?: unknown;
        };
    };
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
export declare function supportsNativeBackgroundBlur(scope?: DetectionScope): boolean;
export declare function detectCapabilities(scope?: DetectionScope): Capabilities;

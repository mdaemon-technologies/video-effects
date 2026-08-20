import { detectCapabilities, supportsNativeBackgroundBlur } from "./capabilities";
import type { DetectionScope } from "./capabilities";

const chromiumScope = (): DetectionScope => ({
  MediaStreamTrackProcessor: function MediaStreamTrackProcessor() {},
  MediaStreamTrackGenerator: function MediaStreamTrackGenerator() {},
  HTMLCanvasElement: { prototype: { captureStream: function captureStream() {} } },
  navigator: {
    mediaDevices: {
      getSupportedConstraints: () => ({ backgroundBlur: true, width: true })
    }
  }
});

const firefoxScope = (): DetectionScope => ({
  // No WebCodecs track transform, but canvas capture works.
  HTMLCanvasElement: { prototype: { captureStream: function captureStream() {} } },
  navigator: {
    mediaDevices: {
      getSupportedConstraints: () => ({ width: true, height: true })
    }
  }
});

describe("detectCapabilities", () => {
  it("picks the WebCodecs path on a Chromium-shaped scope", () => {
    expect(detectCapabilities(chromiumScope())).toEqual({
      insertableStreams: true,
      captureStream: true,
      nativeBackgroundBlur: true,
      supported: true
    });
  });

  it("falls back to canvas capture when the track transform APIs are absent", () => {
    const capabilities = detectCapabilities(firefoxScope());
    expect(capabilities.insertableStreams).toBe(false);
    expect(capabilities.captureStream).toBe(true);
    expect(capabilities.supported).toBe(true);
  });

  it("requires both the processor and the generator, not just one", () => {
    const scope = chromiumScope();
    delete scope.MediaStreamTrackGenerator;
    expect(detectCapabilities(scope).insertableStreams).toBe(false);
  });

  it("reports unsupported when neither capture path exists", () => {
    const capabilities = detectCapabilities({});
    expect(capabilities.supported).toBe(false);
    expect(capabilities.insertableStreams).toBe(false);
    expect(capabilities.captureStream).toBe(false);
  });

  it("does not treat a non-function captureStream property as usable", () => {
    const capabilities = detectCapabilities({
      HTMLCanvasElement: { prototype: { captureStream: true } }
    });
    expect(capabilities.captureStream).toBe(false);
  });
});

describe("supportsNativeBackgroundBlur", () => {
  it("is true only when the constraint is explicitly advertised", () => {
    expect(supportsNativeBackgroundBlur(chromiumScope())).toBe(true);
    expect(supportsNativeBackgroundBlur(firefoxScope())).toBe(false);
  });

  it("rejects a truthy-but-not-true advertisement", () => {
    const scope: DetectionScope = {
      navigator: { mediaDevices: { getSupportedConstraints: () => ({ backgroundBlur: "yes" }) } }
    };
    expect(supportsNativeBackgroundBlur(scope)).toBe(false);
  });

  it("is false when mediaDevices is missing entirely (insecure context)", () => {
    expect(supportsNativeBackgroundBlur({ navigator: {} })).toBe(false);
    expect(supportsNativeBackgroundBlur({})).toBe(false);
  });

  it("survives a getSupportedConstraints that throws", () => {
    const scope: DetectionScope = {
      navigator: {
        mediaDevices: {
          getSupportedConstraints: () => {
            throw new Error("blocked by permissions policy");
          }
        }
      }
    };
    expect(supportsNativeBackgroundBlur(scope)).toBe(false);
  });
});

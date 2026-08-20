import { applyNativeBackgroundBlur } from "./nativeBlur";

interface StubOptions {
  capabilities?: unknown;
  omitApplyConstraints?: boolean;
  fail?: boolean;
}

const stubTrack = (options: StubOptions = {}) => {
  const applied: Array<Record<string, unknown>> = [];
  const track: Record<string, unknown> = {
    kind: "video",
    getCapabilities: () => options.capabilities,
    applyConstraints: async (constraints: Record<string, unknown>) => {
      if (options.fail) {
        throw new Error("OverconstrainedError: backgroundBlur");
      }
      applied.push(constraints);
    }
  };
  if (options.omitApplyConstraints) {
    delete track.applyConstraints;
  }
  return { track: track as unknown as MediaStreamTrack, applied };
};

describe("applyNativeBackgroundBlur", () => {
  it("applies the constraint when the camera advertises the requested state", async () => {
    const { track, applied } = stubTrack({ capabilities: { backgroundBlur: [true, false] } });
    await expect(applyNativeBackgroundBlur(track, true)).resolves.toBe(true);
    expect(applied).toEqual([{ backgroundBlur: true }]);
  });

  it("can turn the blur back off", async () => {
    const { track, applied } = stubTrack({ capabilities: { backgroundBlur: [true, false] } });
    await expect(applyNativeBackgroundBlur(track, false)).resolves.toBe(true);
    expect(applied).toEqual([{ backgroundBlur: false }]);
  });

  it("declines when the camera can only ever blur and cannot be switched off", async () => {
    // A locked-on capability advertises [true] only, so turning it off is not
    // something we can promise the caller.
    const { track, applied } = stubTrack({ capabilities: { backgroundBlur: [true] } });
    await expect(applyNativeBackgroundBlur(track, false)).resolves.toBe(false);
    expect(applied).toEqual([]);
  });

  it("declines when the capability is absent", async () => {
    const { track } = stubTrack({ capabilities: { width: { max: 1920 } } });
    await expect(applyNativeBackgroundBlur(track, true)).resolves.toBe(false);
  });

  it("declines when getCapabilities returns nothing at all", async () => {
    const { track } = stubTrack({ capabilities: undefined });
    await expect(applyNativeBackgroundBlur(track, true)).resolves.toBe(false);
  });

  it("declines rather than throwing when applyConstraints is unavailable", async () => {
    const { track } = stubTrack({
      capabilities: { backgroundBlur: [true, false] },
      omitApplyConstraints: true
    });
    await expect(applyNativeBackgroundBlur(track, true)).resolves.toBe(false);
  });

  it("swallows a rejected applyConstraints and reports failure", async () => {
    // The OS-level toggle can be revoked mid-call; that must not surface as an
    // unhandled rejection in the middle of a conference.
    const { track } = stubTrack({ capabilities: { backgroundBlur: [true, false] }, fail: true });
    await expect(applyNativeBackgroundBlur(track, true)).resolves.toBe(false);
  });

  it("ignores a non-array capability value", async () => {
    const { track } = stubTrack({ capabilities: { backgroundBlur: true } });
    await expect(applyNativeBackgroundBlur(track, true)).resolves.toBe(false);
  });
});

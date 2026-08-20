import FrameWatchdog from "./watchdog";

describe("FrameWatchdog", () => {
  const feed = (dog: FrameWatchdog, ms: number, times: number): boolean => {
    let tripped = false;
    for (let i = 0; i < times; i += 1) {
      tripped = dog.record(ms) || tripped;
    }
    return tripped;
  };

  it("does not trip before a full window has been sampled", () => {
    const dog = new FrameWatchdog({ budgetMs: 10, windowSize: 30, tripRatio: 0.5 });
    // Every one of these is way over budget, but the window is one sample short.
    const tripped = feed(dog, 100, 29);
    expect(tripped).toBe(false);
    expect(dog.tripped).toBe(false);
  });

  it("trips on the sample that completes a window over the trip ratio", () => {
    const dog = new FrameWatchdog({ budgetMs: 10, windowSize: 30, tripRatio: 0.5 });
    expect(feed(dog, 100, 29)).toBe(false);
    expect(dog.record(100)).toBe(true);
    expect(dog.tripped).toBe(true);
  });

  it("stays quiet when frames are comfortably within budget", () => {
    const dog = new FrameWatchdog({ budgetMs: 22, windowSize: 60 });
    expect(feed(dog, 4, 500)).toBe(false);
    expect(dog.tripped).toBe(false);
    expect(dog.averageMs).toBeCloseTo(4);
  });

  it("tolerates occasional slow frames below the trip ratio", () => {
    const dog = new FrameWatchdog({ budgetMs: 20, windowSize: 10, tripRatio: 0.5 });
    // 4 slow out of every 10 - under the 50% threshold, so it must ride it out.
    for (let cycle = 0; cycle < 20; cycle += 1) {
      for (let i = 0; i < 10; i += 1) {
        dog.record(i < 4 ? 50 : 5);
      }
    }
    expect(dog.tripped).toBe(false);
  });

  it("trips once and only once, so callers can use it as an edge trigger", () => {
    const dog = new FrameWatchdog({ budgetMs: 10, windowSize: 4, tripRatio: 0.5 });
    const results = [dog.record(50), dog.record(50), dog.record(50), dog.record(50)];
    expect(results).toEqual([false, false, false, true]);
    // Every later sample reports false even though it is still over budget.
    expect(dog.record(50)).toBe(false);
    expect(dog.record(50)).toBe(false);
    expect(dog.tripped).toBe(true);
  });

  it("reports a rolling average over the sample window only", () => {
    const dog = new FrameWatchdog({ budgetMs: 1000, windowSize: 4 });
    dog.record(10);
    dog.record(20);
    expect(dog.averageMs).toBe(15);
    // Fill and wrap: the first two samples are evicted by the second pass.
    dog.record(30);
    dog.record(40);
    dog.record(100);
    dog.record(100);
    expect(dog.averageMs).toBe((100 + 100 + 30 + 40) / 4);
  });

  it("reports a zero average before any sample arrives", () => {
    expect(new FrameWatchdog().averageMs).toBe(0);
  });

  it("resumes monitoring after reset", () => {
    const dog = new FrameWatchdog({ budgetMs: 10, windowSize: 2, tripRatio: 1 });
    dog.record(50);
    expect(dog.record(50)).toBe(true);
    dog.reset();
    expect(dog.tripped).toBe(false);
    expect(dog.averageMs).toBe(0);
    expect(dog.record(1)).toBe(false);
  });

  it("exposes the configured budget so a degraded event can report it", () => {
    expect(new FrameWatchdog({ budgetMs: 17 }).budgetMs).toBe(17);
    expect(new FrameWatchdog().budgetMs).toBe(22);
  });

  describe("rejects nonsensical configuration", () => {
    it.each([
      ["zero budget", { budgetMs: 0 }],
      ["negative budget", { budgetMs: -5 }],
      ["zero window", { windowSize: 0 }],
      ["fractional window", { windowSize: 2.5 }],
      ["zero trip ratio", { tripRatio: 0 }],
      ["trip ratio above one", { tripRatio: 1.5 }]
    ])("%s", (_label, options) => {
      expect(() => new FrameWatchdog(options)).toThrow(RangeError);
    });
  });

  describe("rejects nonsensical samples", () => {
    it.each([
      ["negative", -1],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY]
    ])("%s", (_label, sample) => {
      expect(() => new FrameWatchdog().record(sample)).toThrow(RangeError);
    });
  });
});

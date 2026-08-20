import TinyEmitter from "./emitter";

interface Events extends Record<string, unknown> {
  ping: number;
  pong: string;
}

describe("TinyEmitter", () => {
  it("delivers a payload to every registered handler", () => {
    const emitter = new TinyEmitter<Events>();
    const a = jest.fn();
    const b = jest.fn();
    emitter.on("ping", a).on("ping", b);

    expect(emitter.emit("ping", 42)).toBe(true);
    expect(a).toHaveBeenCalledWith(42);
    expect(b).toHaveBeenCalledWith(42);
  });

  it("reports false when nothing is listening", () => {
    const emitter = new TinyEmitter<Events>();
    expect(emitter.emit("ping", 1)).toBe(false);
  });

  it("keeps events separate", () => {
    const emitter = new TinyEmitter<Events>();
    const ping = jest.fn();
    emitter.on("ping", ping);
    emitter.emit("pong", "hello");
    expect(ping).not.toHaveBeenCalled();
  });

  it("stops delivering after off", () => {
    const emitter = new TinyEmitter<Events>();
    const handler = jest.fn();
    emitter.on("ping", handler);
    emitter.off("ping", handler);
    emitter.emit("ping", 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("registers the same handler only once", () => {
    const emitter = new TinyEmitter<Events>();
    const handler = jest.fn();
    emitter.on("ping", handler).on("ping", handler);
    emitter.emit("ping", 1);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fires a once handler exactly one time", () => {
    const emitter = new TinyEmitter<Events>();
    const handler = jest.fn();
    emitter.once("ping", handler);
    emitter.emit("ping", 1);
    emitter.emit("ping", 2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it("still notifies later handlers when an earlier one removes itself", () => {
    const emitter = new TinyEmitter<Events>();
    const order: string[] = [];
    const first = (): void => {
      order.push("first");
      emitter.off("ping", first);
    };
    emitter.on("ping", first);
    emitter.on("ping", () => order.push("second"));

    emitter.emit("ping", 1);
    expect(order).toEqual(["first", "second"]);

    order.length = 0;
    emitter.emit("ping", 2);
    expect(order).toEqual(["second"]);
  });

  it("clears everything on removeAllListeners", () => {
    const emitter = new TinyEmitter<Events>();
    const handler = jest.fn();
    emitter.on("ping", handler).on("pong", handler);
    emitter.removeAllListeners();
    emitter.emit("ping", 1);
    emitter.emit("pong", "x");
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects a non-function handler rather than failing at emit time", () => {
    const emitter = new TinyEmitter<Events>();
    expect(() => emitter.on("ping", undefined as never)).toThrow(TypeError);
    expect(() => emitter.on("ping", "nope" as never)).toThrow(TypeError);
  });

  it("tolerates off for a handler that was never registered", () => {
    const emitter = new TinyEmitter<Events>();
    expect(() => emitter.off("ping", jest.fn())).not.toThrow();
  });
});

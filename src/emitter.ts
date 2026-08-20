/**
 * Minimal typed event emitter.
 *
 * Deliberately not @mdaemon/emitter: a dependency-free package drops straight
 * into RTCServer's plain-JS client without a second `copy-globals` entry.
 */
export default class TinyEmitter<EventMap> {
  private handlers = new Map<keyof EventMap, Set<(payload: never) => void>>();

  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): this {
    if (typeof handler !== "function") {
      throw new TypeError(`handler for "${String(event)}" must be a function`);
    }
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (payload: never) => void);
    return this;
  }

  off<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): this {
    this.handlers.get(event)?.delete(handler as (payload: never) => void);
    return this;
  }

  once<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): this {
    const wrapped = (payload: EventMap[K]): void => {
      this.off(event, wrapped);
      handler(payload);
    };
    return this.on(event, wrapped);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): boolean {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) {
      return false;
    }
    // Copy first: a handler removing itself must not disturb this dispatch.
    for (const handler of [...set]) {
      (handler as (value: EventMap[K]) => void)(payload);
    }
    return true;
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }
}

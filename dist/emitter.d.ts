/**
 * Minimal typed event emitter.
 *
 * Deliberately not @mdaemon/emitter: a dependency-free package drops straight
 * into RTCServer's plain-JS client without a second `copy-globals` entry.
 */
export default class TinyEmitter<EventMap> {
    private handlers;
    on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): this;
    off<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): this;
    once<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): this;
    emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): boolean;
    removeAllListeners(): void;
}

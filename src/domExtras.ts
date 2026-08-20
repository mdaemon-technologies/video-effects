/**
 * Shapes for browser APIs that are not in the TypeScript DOM lib.
 *
 * WebCodecs' `MediaStreamTrackProcessor` / `MediaStreamTrackGenerator` live in
 * `@types/dom-mediacapture-transform`, and `backgroundBlur` is not typed
 * anywhere yet. Declaring the little we use locally keeps the package free of a
 * types-only dependency that consumers would also have to install.
 */

export interface VideoFrameLike {
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly timestamp: number;
  close(): void;
}

export interface TrackProcessorLike {
  readable: ReadableStream<VideoFrameLike>;
}

export interface TrackGeneratorLike extends MediaStreamTrack {
  writable: WritableStream<VideoFrameLike>;
}

export interface VideoFrameConstructorLike {
  new (source: CanvasImageSource, init: { timestamp: number; alpha?: "keep" | "discard" }): VideoFrameLike;
}

export interface WebCodecsScope {
  MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => TrackProcessorLike;
  MediaStreamTrackGenerator: new (init: { kind: "video" }) => TrackGeneratorLike;
  VideoFrame: VideoFrameConstructorLike;
}

/**
 * `applyConstraints` / `getCapabilities` widened with the untyped background-blur
 * constraint. Declared as a standalone shape rather than an extension of
 * `MediaStreamTrack`, because narrowing `getCapabilities` to an optional member
 * conflicts with the DOM lib's required one.
 */
export interface BlurCapableTrack {
  applyConstraints?: (constraints: MediaTrackConstraints & { backgroundBlur?: boolean }) => Promise<void>;
  getCapabilities?: () => (MediaTrackCapabilities & { backgroundBlur?: boolean[] }) | undefined;
}

/**
 * Thin wrapper over MediaPipe's `ImageSegmenter`.
 *
 * The MediaPipe runtime is a peer dependency and is never bundled: it is
 * resolved lazily, and only the first time a segmentation-backed effect is
 * switched on. A user who only ever uses the browser's native blur — or who
 * never turns an effect on at all — never downloads it.
 */
export interface MaskResult {
    data: Uint8Array;
    width: number;
    height: number;
}
/** The slice of `@mediapipe/tasks-vision` this package actually uses. */
export interface VisionModule {
    FilesetResolver: {
        forVisionTasks(basePath: string): Promise<unknown>;
    };
    ImageSegmenter: {
        createFromOptions(fileset: unknown, options: Record<string, unknown>): Promise<RawSegmenter>;
    };
}
export interface RawSegmenter {
    segmentForVideo(input: CanvasImageSource, timestampMs: number, callback: (result: RawSegmenterResult) => void): void;
    close(): void;
}
export interface RawSegmenterResult {
    categoryMask?: {
        getAsUint8Array(): Uint8Array;
        width: number;
        height: number;
        close?: () => void;
    };
    close?: () => void;
}
export interface SegmenterInit {
    assetBase: string;
    modelAssetPath?: string;
    /**
     * Pre-resolved MediaPipe module. Supply this when the runtime arrives by
     * `<script>` tag rather than through a bundler — RTCServer's plain-JS client
     * does exactly that.
     */
    visionModule?: VisionModule;
}
/** Dynamic import of the peer dependency; injectable so it can be tested. */
export type VisionImporter = () => Promise<unknown>;
/**
 * Resolution order: explicitly injected module, then a global published by a
 * script tag, then a bundler-resolved dynamic import.
 */
export declare function resolveVisionModule(injected?: VisionModule, scope?: Record<string, unknown>, importer?: VisionImporter): Promise<VisionModule>;
export default class SelfieSegmenter {
    private segmenter;
    private constructor();
    static create(init: SegmenterInit): Promise<SelfieSegmenter>;
    /**
     * Segment one frame.
     *
     * MediaPipe hands the mask back through a callback that it invokes
     * synchronously and then invalidates, so the bytes are copied out before the
     * callback returns.
     */
    segment(frame: CanvasImageSource, timestampMs: number): MaskResult | null;
    close(): void;
}

// Compiled against the staged package by scripts/test-types.mjs, once per
// consumer configuration in this folder; never run. The @ts-expect-error lines
// fail as unused if the import ever resolves to `any`.
import VideoEffects from "@mdaemon/video-effects";
import type {
  BackgroundEffect,
  Capabilities,
  DegradedEvent,
  ProcessOptions,
  VideoEffectsEvent,
  VideoEffectsEventMap,
  VideoEffectsOptions,
  WatchdogOptions
} from "@mdaemon/video-effects";

const watchdog: WatchdogOptions = { budgetMs: 22, windowSize: 60, tripRatio: 0.5 };
const options: VideoEffectsOptions = { assetBase: "/mediapipe", targetFps: 30, watchdog };
const effects = new VideoEffects(options);

const capabilities: Capabilities = VideoEffects.capabilities();
const supported: boolean = VideoEffects.isSupported() && capabilities.supported;

const blur: BackgroundEffect = { type: "blur", strength: 10 };
const image: BackgroundEffect = { type: "image", source: "/background.jpg" };
void effects.setEffect(supported ? blur : image);

export function publish(camera: MediaStreamTrack, processOptions?: ProcessOptions): Promise<MediaStreamTrack> {
  return effects.process(camera, processOptions);
}

effects.on("degraded", (event: DegradedEvent) => {
  const reason: "budget" | "segmentation" = event.reason;
  void reason;
});
effects.once("error", (error) => {
  const message: string = error.message;
  void message;
});
effects.on("effectchange", (effect) => {
  const type: BackgroundEffect["type"] = effect.type;
  void type;
});

const events: VideoEffectsEvent[] = ["degraded", "error", "effectchange"];
const budget: VideoEffectsEventMap["degraded"]["budgetMs"] = 22;
const state: [BackgroundEffect, boolean, boolean] = [effects.effect, effects.degraded, effects.usingHardwareBlur];
void events;
void budget;
void state;

effects.stop();
effects.destroy();

// @ts-expect-error assetBase is required
new VideoEffects({});
// @ts-expect-error not an event VideoEffects emits
effects.on("frame", () => {});
// @ts-expect-error effect types are a closed union
void effects.setEffect({ type: "sepia" });

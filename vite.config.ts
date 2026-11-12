import { defineConfig } from "vitest/config";

export default defineConfig({
  build: {
    lib: {
      entry: "src/videoEffects.ts",
      name: "VideoEffects",
      formats: ["umd", "cjs", "es"],
      fileName: (format) => ({ umd: "videoEffects.umd.js", cjs: "videoEffects.cjs", es: "videoEffects.mjs" })[format]!
    },
    rolldownOptions: {
      // Loaded lazily at runtime; never inlined so consumers dedupe their own copy.
      external: ["@mediapipe/tasks-vision"],
      output: { exports: "default" }
    },
    target: "es2022",
    // Vite leaves ES library output unminified by default; terser keeps all three formats minified.
    minify: "terser"
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"]
  }
});

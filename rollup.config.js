import typescript from "@rollup/plugin-typescript"
import terser from '@rollup/plugin-terser';

export default [
  {
    input: "src/videoEffects.ts",
    output: [
      { file: "dist/videoEffects.umd.js", format: "umd", name: "VideoEffects", exports: "default" },
      { file: "dist/videoEffects.cjs", format: "cjs", name: "VideoEffects", exports: "default" },
      { file: "dist/videoEffects.mjs", format: "es", name: "VideoEffects" }
    ],
    // Loaded lazily at runtime; never inlined so consumers dedupe their own copy.
    external: ["@mediapipe/tasks-vision"],
    plugins: [
      typescript(),
      terser()
    ]
  }
]

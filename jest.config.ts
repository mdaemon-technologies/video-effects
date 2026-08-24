import type { Config } from "@jest/types";

const config: Config.InitialOptions = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  testPathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/node_modules/"],
  // Source imports carry the explicit .js extension Node's ESM loader needs;
  // strip it so Jest resolves the TypeScript file.
  moduleNameMapper: {
    "^(\.{1,2}/.*)\.js$": "$1"
  },
  transform: {
    "^.+\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          verbatimModuleSyntax: false,
          // Tests only. The build config stays browser-only so nothing in src/ can
          // reach for a Node global; the capture-path tests need node:stream/web
          // because jsdom ships no web streams.
          types: ["jest", "node"]
        }
      }
    ]
  }
};

export default config;

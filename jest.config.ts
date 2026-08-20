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
          verbatimModuleSyntax: false
        }
      }
    ]
  }
};

export default config;

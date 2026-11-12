// Type-checks the published declarations the way a consumer sees them. The
// package is staged into a scratch node_modules exactly as `files` publishes it,
// outside this repo so TypeScript cannot shortcut through self-reference, and
// test-types/consumer.ts is compiled against it once per resolution mode.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// Each compiler is called by path. `tsc` on PATH is not TypeScript 7:
// @typescript/typescript6 depends on a real typescript@6, npm hoists it, and its
// bin takes the node_modules/.bin/tsc link.
const compilers = {
  7: join(root, "node_modules", "typescript", "bin", "tsc"),
  6: join(root, "node_modules", "@typescript", "typescript6", "bin", "tsc6")
};

const checks = [
  { config: "tsconfig.bundler.json", typescript: 7 },
  { config: "tsconfig.nodenext.json", typescript: 7 },
  { config: "tsconfig.node10.json", typescript: 6 }
];

const work = mkdtempSync(join(tmpdir(), "video-effects-types-"));
let failures = 0;

try {
  const installed = join(work, "node_modules", ...pkg.name.split("/"));
  mkdirSync(installed, { recursive: true });
  cpSync(join(root, "package.json"), join(installed, "package.json"));
  for (const entry of pkg.files) {
    cpSync(join(root, entry), join(installed, entry), { recursive: true });
  }

  cpSync(join(root, "test-types"), work, { recursive: true });
  writeFileSync(join(work, "package.json"), JSON.stringify({ private: true, type: "module" }));

  for (const { config, typescript } of checks) {
    const result = spawnSync(process.execPath, [compilers[typescript], "-p", join(work, config)], { stdio: "inherit" });
    const passed = result.status === 0;
    if (!passed) failures++;
    console.log(`${passed ? "pass" : "FAIL"}  TypeScript ${typescript}  ${config}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

process.exitCode = failures === 0 ? 0 : 1;

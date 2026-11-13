// Installs the packed package into a scratch project the way a consumer would and
// loads it on whatever Node runs this script. It exists for the Node versions
// that "engines" allows but the dev toolchain cannot run on (Vitest 5 and jsdom
// need 22.12+), so it uses nothing outside Node itself and reads only the
// committed dist/ through `npm pack`.
//
// The optional MediaPipe peer is deliberately not installed: every check here
// must pass without it, which is the native-blur-only consumer's situation.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { name } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// npm runs under this script's Node whenever npm says where its CLI is (it does
// for `npm run`). Otherwise the `npm` on PATH may run on a different Node, and
// --engine-strict would check the wrong version.
const npmCli = /\.c?js$/.test(process.env.npm_execpath ?? "") ? process.env.npm_execpath : null;

// The npm fallback is a .cmd shim on Windows, which spawn only finds through a
// shell. Node itself must not go through one: its path usually contains a space.
function run(command, args, cwd) {
  if (command === "npm" && npmCli) {
    [command, args] = [process.execPath, [npmCli, ...args]];
  }
  const shell = command === "npm" && process.platform === "win32";
  const result = spawnSync(command, args, { cwd, encoding: "utf8", shell });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

// Serialized into both consumers, so CommonJS and ESM run the same checks.
// Node has no DOM, so this is the graceful-degradation path end to end.
async function checks(VideoEffects, assert) {
  assert.equal(typeof VideoEffects, "function", "default export is the class");
  assert.equal(VideoEffects.isSupported(), false, "no capture path outside a browser");
  assert.deepEqual(VideoEffects.capabilities(), {
    insertableStreams: false,
    captureStream: false,
    nativeBackgroundBlur: false,
    supported: false
  });

  assert.throws(() => new VideoEffects({}), /assetBase/);
  assert.throws(() => new VideoEffects({ assetBase: "/wasm", targetFps: 0 }), RangeError);

  const fx = new VideoEffects({ assetBase: "/wasm" });
  const seen = [];
  fx.on("effectchange", (effect) => seen.push(effect.type));
  fx.on("error", (error) => seen.push(`error: ${error.message}`));

  await assert.rejects(fx.setEffect({ type: "sepia" }), TypeError);
  await assert.rejects(fx.setEffect({ type: "blur", strength: 0 }), RangeError);

  const track = { kind: "video", id: "fake-camera" };
  assert.equal(await fx.process(track), track, "effect none returns the input track");

  await fx.setEffect({ type: "blur", strength: 10 });
  assert.equal(await fx.process(track), track, "unsupported platform returns the input track");
  assert.equal(seen[0], "blur");
  assert.match(String(seen[1]), /^error: no usable frame capture path/);
  assert.equal(fx.effect.type, "blur");
  assert.equal(fx.usingHardwareBlur, false);

  fx.stop();
  fx.destroy();
}

const consumers = {
  "check.cjs": `const assert = require("node:assert/strict");
const VideoEffects = require(${JSON.stringify(name)});
(${checks})(VideoEffects, assert).then(
  () => console.log("pass  require()"),
  (error) => { console.error(error); process.exitCode = 1; }
);
`,
  "check.mjs": `import assert from "node:assert/strict";
import VideoEffects from ${JSON.stringify(name)};
await (${checks})(VideoEffects, assert);
console.log("pass  import");
`
};

const work = mkdtempSync(join(tmpdir(), "video-effects-smoke-"));
try {
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", work], root));
  const tarball = join(work, packed[0].filename);

  writeFileSync(join(work, "package.json"), JSON.stringify({ name: "smoke-consumer", private: true }));
  // --engine-strict turns an "engines" range that excludes this Node into a failure.
  run("npm", ["install", tarball, "--engine-strict", "--no-audit", "--no-fund", "--no-package-lock"], work);

  for (const [file, source] of Object.entries(consumers)) {
    writeFileSync(join(work, file), source);
    process.stdout.write(run(process.execPath, [file], work));
  }
  console.log(`smoke test passed on Node ${process.versions.node}`);
} catch (error) {
  console.error(error.message ?? error);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}

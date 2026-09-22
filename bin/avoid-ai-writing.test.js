"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CLI = path.join(__dirname, "avoid-ai-writing.js");
const AIDetector = require("../detector/patterns.js");

const SAMPLE =
  "In today's fast-paced world, it is important to note that this is a testament to innovation.";

function run(args, input, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { input, encoding: "utf8", cwd });
}

// stdin: the complete analyzeText() result as JSON
const fromStdin = run([], SAMPLE);
assert.strictEqual(fromStdin.status, 0, fromStdin.stderr);
const stdinJson = JSON.parse(fromStdin.stdout);
assert.deepStrictEqual(stdinJson, JSON.parse(JSON.stringify(AIDetector.analyzeText(SAMPLE))));

// file input produces the same JSON as stdin for the same text
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-cli-"));
const file = path.join(tmp, "sample.txt");
fs.writeFileSync(file, SAMPLE, "utf8");
const fromFile = run([file]);
assert.strictEqual(fromFile.status, 0, fromFile.stderr);
assert.deepStrictEqual(JSON.parse(fromFile.stdout), stdinJson);

// both options reach analyzeText() and are reflected in stats
const withOptions = run(["--context", "technical", "--source-mode", "rendered-markdown"], SAMPLE);
assert.strictEqual(withOptions.status, 0, withOptions.stderr);
const optionsJson = JSON.parse(withOptions.stdout);
assert.strictEqual(optionsJson.stats.contextMode, "technical");
assert.strictEqual(optionsJson.stats.sourceMode, "rendered-markdown");

// every context the engine and the gate CLI accept is accepted here too
for (const context of ["general", "technical", "marketing", "personal"]) {
  const res = run(["--context", context], SAMPLE);
  assert.strictEqual(res.status, 0, `${context}: ${res.stderr}`);
  assert.strictEqual(JSON.parse(res.stdout).stats.contextMode, context);
}

// --help prints usage and exits 0
const help = run(["--help"]);
assert.strictEqual(help.status, 0);
assert.ok(help.stdout.includes("Usage: avoid-ai-writing"), "expected usage text on stdout");
assert.ok(
  help.stdout.includes("npx --package avoid-ai-writing-detector avoid-ai-writing"),
  "expected npx to name the package explicitly",
);
assert.ok(
  help.stdout.includes("--context <general|technical|marketing|personal>"),
  "expected --help to list the same contexts as the gate CLI",
);

// "--" ends option parsing, so dash-prefixed file names still work
const dashFile = path.join(tmp, "-draft.md");
fs.writeFileSync(dashFile, SAMPLE, "utf8");
const fromDashFile = run(["--", "-draft.md"], undefined, tmp);
assert.strictEqual(fromDashFile.status, 0, fromDashFile.stderr);
assert.deepStrictEqual(JSON.parse(fromDashFile.stdout), stdinJson);

// Invalid UTF-8 fails instead of silently scoring replacement characters
const invalidUtf8 = path.join(tmp, "invalid-utf8.txt");
fs.writeFileSync(invalidUtf8, Buffer.from([0xc3, 0x28]));
const fromInvalidUtf8 = run([invalidUtf8]);
assert.strictEqual(fromInvalidUtf8.status, 2);
assert.strictEqual(fromInvalidUtf8.stdout, "");
assert.match(fromInvalidUtf8.stderr, /input is not valid UTF-8/);

// empty input is still a successful analysis, and the selected modes stay visible
const emptyDefault = run([], "");
assert.strictEqual(emptyDefault.status, 0, emptyDefault.stderr);
const emptyJson = JSON.parse(emptyDefault.stdout);
assert.strictEqual(emptyJson.stats.contextMode, "general");
assert.strictEqual(emptyJson.stats.sourceMode, "plain");
const emptyTechnical = run(["--context", "technical"], "");
assert.strictEqual(emptyTechnical.status, 0, emptyTechnical.stderr);
assert.strictEqual(JSON.parse(emptyTechnical.stdout).stats.contextMode, "technical");

// errors: exit 2 with nothing on stdout
const errorCases = [
  ["unknown option", ["--nope"]],
  ["unknown option after help", ["--help", "--nope"]],
  ["missing value", ["--context"]],
  ["invalid context", ["--context", "nope"]],
  ["invalid source mode", ["--source-mode", "nope"]],
  ["multiple files", [file, file]],
  ["unreadable file", [path.join(tmp, "missing.txt")]],
];

for (const [label, args] of errorCases) {
  const res = run(args);
  assert.strictEqual(res.status, 2, `${label}: expected exit 2`);
  assert.strictEqual(res.stdout, "", `${label}: expected no stdout`);
  assert.ok(res.stderr.length > 0, `${label}: expected stderr output`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("avoid-ai-writing cli: ok");

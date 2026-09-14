"use strict";

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CLI = path.join(__dirname, "avoid-ai-writing-gate.js");
const FLAGGED = "In today's fast-paced world, it is important to note that this is a testament to innovation.";

function run(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", cwd });
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "aaw-gate-"));
const flagged = path.join(tmp, "flagged.md");
fs.writeFileSync(flagged, FLAGGED, "utf8");

const strict = run(["--threshold", "0", flagged]);
assert.strictEqual(strict.status, 1, strict.stderr);
assert.match(strict.stdout, /^FAIL /m);

const permissive = run(["--threshold", "999", flagged]);
assert.strictEqual(permissive.status, 0, permissive.stderr);
assert.match(permissive.stdout, /^PASS /m);

const help = run(["--help"]);
assert.strictEqual(help.status, 0);
assert.match(help.stdout, /never uses the composite 0-100 score/);
assert.match(help.stdout, /default: 6/);

const clean = path.join(tmp, "clean.md");
fs.writeFileSync(clean, "The deploy finished after the migration. The team checked logs, verified the database, and closed the incident.", "utf8");
const defaultThreshold = run([clean]);
assert.strictEqual(defaultThreshold.status, 0, defaultThreshold.stderr);
assert.match(defaultThreshold.stdout, /threshold 6/);

const badThreshold = run(["--threshold", "1.5", flagged]);
assert.strictEqual(badThreshold.status, 2);
assert.match(badThreshold.stderr, /invalid --threshold/);

const noInput = run([]);
assert.strictEqual(noInput.status, 2);
assert.match(noInput.stderr, /provide at least one file or --glob/);

const tooLong = path.join(tmp, "too-long.md");
fs.writeFileSync(tooLong, `${"word ".repeat(10001)}\n`, "utf8");
const oversized = run([tooLong]);
assert.strictEqual(oversized.status, 2, oversized.stderr);
assert.match(oversized.stderr, /detector limit exceeded/);
assert.doesNotMatch(oversized.stdout, /^PASS /m);

const gitRepo = path.join(tmp, "repo");
fs.mkdirSync(gitRepo);
spawnSync("git", ["init", "-q"], { cwd: gitRepo });
fs.mkdirSync(path.join(gitRepo, "docs"));
fs.writeFileSync(path.join(gitRepo, "docs", "draft.md"), FLAGGED, "utf8");
fs.writeFileSync(path.join(gitRepo, "ignore.js"), "const x = 1;\n", "utf8");
spawnSync("git", ["add", "."], { cwd: gitRepo });
const globbed = run(["--glob", "**/*.md", "--threshold", "0"], gitRepo);
assert.strictEqual(globbed.status, 1, globbed.stderr);
assert.match(globbed.stdout, /docs[\\/]draft\.md/);
assert.doesNotMatch(globbed.stdout, /ignore\.js/);

fs.writeFileSync(path.join(gitRepo, "-draft.md"), FLAGGED, "utf8");
const dashPrefixed = run(["--threshold", "0", "--", "-draft.md"], gitRepo);
assert.strictEqual(dashPrefixed.status, 1, dashPrefixed.stderr);
assert.match(dashPrefixed.stdout, /-draft\.md/);
assert.doesNotMatch(dashPrefixed.stderr, /unknown option/);

// Exercise entry + configured args + filenames in pre-commit's actual order.
// A separator baked into entry turns override options into filenames.
const manifest = fs.readFileSync(path.join(__dirname, "../.pre-commit-hooks.yaml"), "utf8");
const entry = manifest.match(/^  entry: (.+)$/m)[1].trim().split(/\s+/).slice(1);
const defaultsMatch = manifest.match(/^  args: (.+)$/m);
const defaultArgs = defaultsMatch ? JSON.parse(defaultsMatch[1]) : [];
const hook = (args, filename = "-draft.md") => run([...entry, ...args, filename], gitRepo);
const hookDefault = hook(defaultArgs);
assert.strictEqual(hookDefault.status, 0, hookDefault.stderr);
assert.match(hookDefault.stdout, /threshold 6/);
const hookStrict = hook(["--threshold", "0", "--"]);
assert.strictEqual(hookStrict.status, 1, hookStrict.stderr);
assert.match(hookStrict.stdout, /^FAIL .*threshold 0/m);
const hookPermissive = hook(["--threshold", "999", "--"]);
assert.strictEqual(hookPermissive.status, 0, hookPermissive.stderr);
assert.match(hookPermissive.stdout, /threshold 999/);
fs.writeFileSync(path.join(gitRepo, "comment.md"), "<!-- " + FLAGGED + " -->\nThe deploy finished.\n", "utf8");
assert.strictEqual(hook(["--threshold", "0", "--"], "comment.md").status, 0);
assert.strictEqual(hook(["--threshold", "0", "--source-mode", "plain", "--"], "comment.md").status, 1);
const hookContext = hook(["--context", "not-a-context", "--"]);
assert.strictEqual(hookContext.status, 2);
assert.match(hookContext.stderr, /context/);
assert.doesNotMatch(hookContext.stderr, /ENOENT/);
const hookSource = hook(["--source-mode", "not-a-mode", "--"]);
assert.strictEqual(hookSource.status, 2);
assert.match(hookSource.stderr, /source-mode/);
assert.doesNotMatch(hookSource.stderr, /ENOENT/);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("avoid-ai-writing gate cli: ok");

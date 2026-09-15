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

const unsafeThreshold = run(["--threshold", "999999999999999999999999999999", flagged]);
assert.strictEqual(unsafeThreshold.status, 2);
assert.match(unsafeThreshold.stderr, /invalid --threshold/);

const infinityThreshold = run(["--threshold", "1".repeat(400), flagged]);
assert.strictEqual(infinityThreshold.status, 2);
assert.match(infinityThreshold.stderr, /invalid --threshold/);

const noInput = run([]);
assert.strictEqual(noInput.status, 2);
assert.match(noInput.stderr, /provide at least one file or --glob/);

const tooLong = path.join(tmp, "too-long.md");
fs.writeFileSync(tooLong, `${"word ".repeat(10001)}\n`, "utf8");
const oversized = run([tooLong]);
assert.strictEqual(oversized.status, 2, oversized.stderr);
assert.match(oversized.stderr, /detector limit exceeded/);
assert.doesNotMatch(oversized.stdout, /^PASS /m);

// An unsegmented-script document (Chinese/Japanese: no inter-word spaces) is
// declined, not scored; the gate must exit 2 rather than pass silently (#241).
const cjk = path.join(tmp, "cjk.md");
fs.writeFileSync(cjk, "这个函数返回一个承诺，调用方不应假设句柄之后仍可重用。".repeat(50), "utf8");
const cjkRun = run([cjk]);
assert.strictEqual(cjkRun.status, 2, cjkRun.stderr);
assert.match(cjkRun.stderr, /unsegmented-script document/);
assert.doesNotMatch(cjkRun.stdout, /^PASS /m);

// A short English document with an incidental CJK place name is not an
// unsegmented-script document: the dominance check keeps it scorable, so
// the gate must not exit 2 on it (#241 review follow-up).
const mixed = path.join(tmp, "mixed.md");
fs.writeFileSync(mixed, "The Tokyo (東京) office owns the retry limit docs.", "utf8");
const mixedRun = run([mixed]);
assert.notStrictEqual(mixedRun.status, 2, mixedRun.stderr);
assert.doesNotMatch(mixedRun.stderr, /cannot scan/);

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

// Machine-readable --json output tests (#252)
const jsonPassing = run(["--json", clean]);
assert.strictEqual(jsonPassing.status, 0, jsonPassing.stderr);
assert.strictEqual(jsonPassing.stderr, "");
const passData = JSON.parse(jsonPassing.stdout);
assert.strictEqual(passData.schemaVersion, 1);
assert.strictEqual(passData.threshold, 6);
assert.strictEqual(passData.context, "technical");
assert.strictEqual(passData.sourceMode, "rendered-markdown");
assert.strictEqual(passData.pass, true);
assert.strictEqual(passData.totalFindings, 0);
assert.strictEqual(passData.failedFiles, 0);
assert.strictEqual(passData.files.length, 1);
assert.strictEqual(passData.files[0].path, clean.split(path.sep).join("/"));
assert.strictEqual(passData.files[0].findings, 0);
assert.strictEqual(passData.files[0].pass, true);
assert.deepStrictEqual(passData.files[0].types, []);

const jsonFailing = run(["--threshold", "0", "--json", flagged]);
assert.strictEqual(jsonFailing.status, 1, jsonFailing.stderr);
assert.strictEqual(jsonFailing.stderr, "");
const failData = JSON.parse(jsonFailing.stdout);
assert.strictEqual(failData.schemaVersion, 1);
assert.strictEqual(failData.threshold, 0);
assert.strictEqual(failData.pass, false);
assert.ok(failData.totalFindings > 0);
assert.strictEqual(failData.failedFiles, 1);
assert.strictEqual(failData.files.length, 1);
assert.strictEqual(failData.files[0].path, flagged.split(path.sep).join("/"));
assert.strictEqual(failData.files[0].pass, false);
assert.strictEqual(failData.files[0].findings, failData.totalFindings);
assert.ok(failData.files[0].types.length > 0);

const jsonMixed = run(["--threshold", "0", "--json", clean, flagged]);
assert.strictEqual(jsonMixed.status, 1, jsonMixed.stderr);
assert.strictEqual(jsonMixed.stderr, "");
const mixedData = JSON.parse(jsonMixed.stdout);
assert.strictEqual(mixedData.schemaVersion, 1);
assert.strictEqual(mixedData.pass, false);
assert.strictEqual(mixedData.failedFiles, 1);
assert.strictEqual(mixedData.totalFindings, failData.totalFindings);
assert.strictEqual(mixedData.files.length, 2);
const cleanEntry = mixedData.files.find((f) => f.path === clean.split(path.sep).join("/"));
const flaggedEntry = mixedData.files.find((f) => f.path === flagged.split(path.sep).join("/"));
assert.ok(cleanEntry && cleanEntry.pass && cleanEntry.findings === 0);
assert.ok(flaggedEntry && !flaggedEntry.pass && flaggedEntry.findings > 0);

const jsonEmpty = run(["--glob", "nonexistent/**/*.md", "--json"], gitRepo);
assert.strictEqual(jsonEmpty.status, 0, jsonEmpty.stderr);
assert.strictEqual(jsonEmpty.stderr, "");
const emptyData = JSON.parse(jsonEmpty.stdout);
assert.strictEqual(emptyData.schemaVersion, 1);
assert.strictEqual(emptyData.pass, true);
assert.strictEqual(emptyData.totalFindings, 0);
assert.strictEqual(emptyData.failedFiles, 0);
assert.deepStrictEqual(emptyData.files, []);

const jsonCustom = run(["--threshold", "2", "--context", "general", "--source-mode", "plain", "--json", clean]);
assert.strictEqual(jsonCustom.status, 0, jsonCustom.stderr);
const customData = JSON.parse(jsonCustom.stdout);
assert.strictEqual(customData.threshold, 2);
assert.strictEqual(customData.context, "general");
assert.strictEqual(customData.sourceMode, "plain");

const action = fs.readFileSync(path.join(__dirname, "../action.yml"), "utf8");
assert.match(action, /trap 'rm -f "\$TMP_JSON"' EXIT/);
assert.match(action, /EXIT_CODE=2/);
assert.match(action, /could not create a temporary output file/);
assert.match(action, /could not initialize action outputs/);
assert.match(action, /gate process exited unexpectedly with status \$EXIT_CODE/);
assert.match(action, /unset when the scan exits with an operational error/g);

fs.rmSync(tmp, { recursive: true, force: true });
console.log("avoid-ai-writing gate cli: ok");

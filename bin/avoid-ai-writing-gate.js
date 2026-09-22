#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { TextDecoder } = require("util");
const AIDetector = require("../detector/patterns.js");

const USAGE = `Usage: avoid-ai-writing-gate [options] [files...]

Fails when any scanned file has more deterministic detector findings than
the configured threshold. This gate never uses the composite 0-100 score.

Options:
  --glob <pattern>                         Git glob to scan (for CI)
  --threshold <count>                     Maximum findings per file (default: 6)
  --context <general|technical|marketing|personal>  Detector context (default: technical)
  --source-mode <plain|rendered-markdown>  Source mode (default: rendered-markdown)
  --json                                   Emit machine-readable JSON on stdout
  -h, --help                               Show this help

Examples:
  avoid-ai-writing-gate --glob "**/*.md" --threshold 6
  avoid-ai-writing-gate --context technical README.md docs/guide.md
`;

const CONTEXTS = ["general", "technical", "marketing", "personal"];
const SOURCE_MODES = ["plain", "rendered-markdown"];

function parseArgs(argv) {
  const options = { help: false, json: false, glob: null, threshold: 6, context: "technical", sourceMode: "rendered-markdown", files: [] };
  let endOfOptions = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (endOfOptions) { options.files.push(arg); continue; }
    if (arg === "--") { endOfOptions = true; continue; }
    if (arg === "-h" || arg === "--help") { options.help = true; continue; }
    if (arg === "--json") { options.json = true; continue; }
    if (["--glob", "--threshold", "--context", "--source-mode"].includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined) return { error: `${arg} requires a value` };
      i += 1;
      if (arg === "--glob") options.glob = value;
      if (arg === "--threshold") {
        if (!/^\d+$/.test(value)) return { error: `invalid --threshold value: ${value}` };
        const num = Number(value);
        if (!Number.isSafeInteger(num) || num < 0) return { error: `invalid --threshold value: ${value}` };
        options.threshold = num;
      }
      if (arg === "--context") {
        if (!CONTEXTS.includes(value)) return { error: `invalid --context value: ${value}` };
        options.context = value;
      }
      if (arg === "--source-mode") {
        if (!SOURCE_MODES.includes(value)) return { error: `invalid --source-mode value: ${value}` };
        options.sourceMode = value;
      }
      continue;
    }
    if (arg.startsWith("-") && arg !== "-") return { error: `unknown option: ${arg}` };
    options.files.push(arg);
  }
  if (!options.help && !options.glob && options.files.length === 0) {
    return { error: "provide at least one file or --glob" };
  }
  return options;
}

function filesFromGlob(pattern, cwd = process.cwd()) {
  const result = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", `:(glob)${pattern}`], { cwd, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : result.stderr.trim();
    return { error: `cannot expand --glob with git: ${detail || "git ls-files failed"}` };
  }
  return { files: result.stdout.split("\0").filter(Boolean) };
}

function readUtf8(file) {
  let input;
  try { input = fs.readFileSync(file); }
  catch (error) { return { error: `cannot read ${file}: ${error.message}` }; }
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(input) }; }
  catch { return { error: `cannot read ${file}: input is not valid UTF-8` }; }
}

function main(argv) {
  const parsed = parseArgs(argv);
  if (parsed.error) { process.stderr.write(`avoid-ai-writing-gate: ${parsed.error}\n\n${USAGE}`); return 2; }
  if (parsed.help) { process.stdout.write(USAGE); return 0; }
  let files = [...parsed.files];
  if (parsed.glob) {
    const expanded = filesFromGlob(parsed.glob);
    if (expanded.error) { process.stderr.write(`avoid-ai-writing-gate: ${expanded.error}\n`); return 2; }
    files.push(...expanded.files);
  }
  files = [...new Set(files.map((file) => path.normalize(file)))];
  if (files.length === 0) {
    if (parsed.json) {
      const emptyPayload = {
        schemaVersion: 1,
        threshold: parsed.threshold,
        context: parsed.context,
        sourceMode: parsed.sourceMode,
        pass: true,
        totalFindings: 0,
        failedFiles: 0,
        files: []
      };
      process.stdout.write(JSON.stringify(emptyPayload, null, 2) + "\n");
      return 0;
    }
    process.stdout.write("avoid-ai-writing-gate: no matching files; nothing to scan\n");
    return 0;
  }
  let failed = false;
  let totalFindings = 0;
  let failedFiles = 0;
  const fileEntries = [];
  for (const file of files) {
    const input = readUtf8(file);
    if (input.error) { process.stderr.write(`avoid-ai-writing-gate: ${input.error}\n`); return 2; }
    const result = AIDetector.analyzeText(input.text, { contextMode: parsed.context, sourceMode: parsed.sourceMode });
    if (result.tooLong) {
      const wordCount = result.stats?.wordCount;
      const detail = Number.isFinite(wordCount) ? ` (${wordCount} words)` : "";
      process.stderr.write(
        `avoid-ai-writing-gate: cannot scan ${file}: detector limit exceeded${detail}\n`
      );
      return 2;
    }
    if (result.unsupportedScript) {
      // An unsegmented-script document (Chinese/Japanese: no inter-word
      // spaces) was declined, not scored. README classifies unscannable
      // input as exit 2, so the gate must not report green on it. (GH-241)
      process.stderr.write(
        `avoid-ai-writing-gate: cannot scan ${file}: unsegmented-script document (no inter-word spaces to count)\n`
      );
      return 2;
    }
    const count = result.issues.length;
    const types = [...new Set(result.issues.map((issue) => issue.type))].sort();
    const over = count > parsed.threshold;
    if (over) {
      failed = true;
      failedFiles += 1;
    }
    totalFindings += count;
    const outputPath = file.split(path.sep).join("/");
    fileEntries.push({ path: outputPath, findings: count, pass: !over, types });
    if (!parsed.json) {
      const label = over ? "FAIL" : "PASS";
      const typeSummary = types.length ? ` [${types.join(", ")}]` : "";
      process.stdout.write(`${label} ${file} — ${count} finding(s), threshold ${parsed.threshold}${typeSummary}\n`);
    }
  }
  if (parsed.json) {
    const payload = {
      schemaVersion: 1,
      threshold: parsed.threshold,
      context: parsed.context,
      sourceMode: parsed.sourceMode,
      pass: !failed,
      totalFindings,
      failedFiles,
      files: fileEntries
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  }
  return failed ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { parseArgs, filesFromGlob, main };

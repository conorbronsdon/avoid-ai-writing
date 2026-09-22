#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { TextDecoder } = require("util");
const AIDetector = require("../detector/patterns.js");

const USAGE = `Usage: avoid-ai-writing [options] [file]

Scores UTF-8 text from a file path or stdin and prints the complete
analyzeText() result as JSON to stdout. Read-only: nothing is modified.
Exits 0 after a successful analysis, 2 on usage or I/O errors.

Options:
  --context <general|technical|marketing|personal>
                                         Analysis context (default: general)
  --source-mode <plain|rendered-markdown>
                                         Plain text (default) or rendered
                                         Markdown, which excludes YAML
                                         frontmatter and HTML comments from
                                         the score
  -h, --help                             Show this help

Use "--" to stop option parsing when the file name starts with a dash.

Examples:
  npx --package avoid-ai-writing-detector avoid-ai-writing draft.md
  cat draft.md | npx --package avoid-ai-writing-detector avoid-ai-writing --context technical
  npx --package avoid-ai-writing-detector avoid-ai-writing --source-mode rendered-markdown -- --draft.md
`;

const CONTEXTS = ["general", "technical", "marketing", "personal"];
const SOURCE_MODES = ["plain", "rendered-markdown"];

function parseArgs(argv) {
  const options = { help: false, context: "general", sourceMode: "plain", files: [] };
  let endOfOptions = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (endOfOptions) {
      options.files.push(arg);
      continue;
    }

    if (arg === "--") {
      endOfOptions = true;
      continue;
    }

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--context" || arg === "--source-mode") {
      const value = argv[i + 1];
      if (value === undefined) {
        return { error: `${arg} requires a value` };
      }
      i += 1;
      if (arg === "--context") {
        if (!CONTEXTS.includes(value)) {
          return { error: `invalid --context value: ${value}` };
        }
        options.context = value;
      } else {
        if (!SOURCE_MODES.includes(value)) {
          return { error: `invalid --source-mode value: ${value}` };
        }
        options.sourceMode = value;
      }
      continue;
    }

    if (arg.startsWith("-") && arg !== "-") {
      return { error: `unknown option: ${arg}` };
    }
    options.files.push(arg);
  }

  if (options.files.length > 1) {
    return { error: "expected at most one file path" };
  }

  return options;
}

function readInput(file) {
  const fromStdin = file === undefined || file === "-";
  const source = fromStdin ? "stdin" : file;
  let input;
  try {
    input = fs.readFileSync(fromStdin ? 0 : file);
  } catch (error) {
    return { error: `cannot read ${source}: ${error.message}` };
  }

  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(input) };
  } catch {
    return { error: `cannot read ${source}: input is not valid UTF-8` };
  }
}

function main(argv) {
  const parsed = parseArgs(argv);

  if (parsed.error) {
    process.stderr.write(`avoid-ai-writing: ${parsed.error}\n\n${USAGE}`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const input = readInput(parsed.files[0]);
  if (input.error) {
    process.stderr.write(`avoid-ai-writing: ${input.error}\n\n${USAGE}`);
    return 2;
  }

  const result = AIDetector.analyzeText(input.text, {
    contextMode: parsed.context,
    sourceMode: parsed.sourceMode,
  });

  // analyzeText() returns an empty stats object for empty input. Surface the
  // selected modes anyway so the CLI's option contract holds in every case.
  if (result.stats && Object.keys(result.stats).length === 0) {
    result.stats.contextMode = parsed.context;
    result.stats.sourceMode = parsed.sourceMode;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));

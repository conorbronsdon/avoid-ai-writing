#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const AIDetector = require("./patterns.js");

const USAGE = `Usage: detect.js [options]

Scores UTF-8 text from --file or stdin and prints the complete analyzeText()
result as JSON to stdout. Read-only: nothing is modified.
Exits 0 after a successful analysis, 2 on usage or I/O errors.

Options:
  --file <path>                            Read the text from a file (default: stdin)
  --context <general|technical|marketing|personal>
                                           Analysis context (default: general)
  --source-mode <plain|rendered-markdown>
                                           Plain text (default) or rendered
                                           Markdown, which excludes YAML
                                           frontmatter and HTML comments from
                                           the score
  -h, --help                               Show this help

Examples:
  printf '%s' "$TEXT" | node scripts/detect.js --context general
  node scripts/detect.js --file path/to/draft.md --source-mode rendered-markdown
`;

const CONTEXTS = AIDetector.CONTEXT_MODES;
const SOURCE_MODES = AIDetector.SOURCE_MODES;

function parseArgs(argv) {
  const options = { help: false, file: null, context: "general", sourceMode: "plain" };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }

    if (arg === "--file" || arg === "--context" || arg === "--source-mode") {
      const value = argv[i + 1];
      if (value === undefined) {
        return { error: `${arg} requires a value` };
      }
      i += 1;
      if (arg === "--file") {
        options.file = value;
      } else if (arg === "--context") {
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

    return { error: `unknown argument: ${arg}` };
  }

  return options;
}

function readInput(file) {
  const source = file === null ? "stdin" : file;
  try {
    return { text: fs.readFileSync(file === null ? 0 : path.resolve(file), "utf8") };
  } catch (error) {
    return { error: `cannot read ${source}: ${error.message}` };
  }
}

function main(argv) {
  const parsed = parseArgs(argv);

  if (parsed.error) {
    process.stderr.write(`detect.js: ${parsed.error}\n\n${USAGE}`);
    return 2;
  }

  if (parsed.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const input = readInput(parsed.file);
  if (input.error) {
    process.stderr.write(`detect.js: ${input.error}\n\n${USAGE}`);
    return 2;
  }

  const result = AIDetector.analyzeText(input.text, {
    contextMode: parsed.context,
    sourceMode: parsed.sourceMode,
  });

  // analyzeText() returns an empty stats object for empty input. Surface the
  // selected modes anyway, exactly as the root CLI does, so the option
  // contract holds in every case and blank input does not diverge between the
  // two entry points.
  if (result.stats && Object.keys(result.stats).length === 0) {
    result.stats.contextMode = parsed.context;
    result.stats.sourceMode = parsed.sourceMode;
  }

  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return 0;
}

process.exitCode = main(process.argv.slice(2));

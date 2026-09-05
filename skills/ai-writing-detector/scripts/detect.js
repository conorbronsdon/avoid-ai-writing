#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const AIDetector = require("./patterns.js");

const args = process.argv.slice(2);
let file = null;
let contextMode = "general";

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--file") {
    if (!args[i + 1]) throw new Error("--file requires a path");
    file = args[++i];
  } else if (arg === "--context") {
    if (!args[i + 1]) throw new Error("--context requires general or technical");
    contextMode = args[++i];
  } else {
    throw new Error(`unknown argument: ${arg}`);
  }
}

if (!["general", "technical"].includes(contextMode)) {
  throw new Error("--context must be general or technical");
}

const text = file ? fs.readFileSync(path.resolve(file), "utf8") : fs.readFileSync(0, "utf8");
const result = AIDetector.analyzeText(text, { contextMode });
process.stdout.write(JSON.stringify(result, null, 2) + "\n");

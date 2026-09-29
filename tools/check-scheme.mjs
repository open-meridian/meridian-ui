#!/usr/bin/env node
// Check a colour scheme against the contract, naming each failing pair.
//
//   node tools/check-scheme.mjs <scheme.css | scheme.json> [...]
//
// A .css file is read as the stylesheet the dashboard serves
// (schemes/<id>.css); a .json file is { light: {…}, dark: {…} }. Exits 1 when
// any scheme fails.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkScheme } from "../src/lib/contrast.js";
import { parseSchemeCss } from "../src/lib/scheme.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contract = JSON.parse(readFileSync(join(ROOT, "contract/scheme.json"), "utf8"));
const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: check-scheme.mjs <scheme.css | scheme.json> [...]");
  process.exit(2);
}

let failed = false;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const shape = file.endsWith(".json") ? { scheme: JSON.parse(text), problems: [] } : parseSchemeCss(text);
  const result = checkScheme(shape.scheme, contract);
  const problems = [...shape.problems, ...result.problems];
  if (problems.length) {
    failed = true;
    console.log(`${file}: FAILS\n  ${problems.join("\n  ")}`);
  } else {
    const worst = result.results.reduce((a, b) => (b.ratio / b.min < a.ratio / a.min ? b : a));
    console.log(`${file}: OK, ${result.results.length} pairs pass (closest: ${worst.mode} --${worst.fg} on --${worst.bg}, ${worst.ratio.toFixed(2)}:1 against ${worst.min}:1)`);
  }
}
process.exit(failed ? 1 : 0);

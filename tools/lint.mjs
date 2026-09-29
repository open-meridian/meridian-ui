#!/usr/bin/env node
// The kit's lint: what a review should never have to catch.
//
// 1. Every script parses (modules as modules, the classic scripts as scripts).
// 2. No raw colour in anything hand-written: a colour is a scheme property.
// 3. Every custom property used is one the kit defines (a scheme property, a
//    brand token, or a listed local), and no hand-written stylesheet declares
//    a scheme's colour.
// 4. What the kit serves reaches nowhere else: no absolute URL, no other
//    origin, nothing from a CDN (dist/<version>/, when built).

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLASSIC = new Set(["src/meridian.js", "src/gallery/stand-in.js"]);
// Custom properties the kit uses that are neither a scheme's nor a token:
// each has a fallback where it is used, and a reason.
const LOCAL_PROPERTIES = {
  "om-grid-height": "the height of an om-grid with sticky-head; a page may set it",
};
const SVG_NS = "http://www.w3.org/2000/svg";
// Files that handle colours as data, never as style: they are what checks them.
const COLOUR_DATA = {
  "src/lib/contrast.js": "the contrast check parses colour values",
  "src/lib/scheme.js": "renders and reads scheme stylesheets",
};

const problems = [];
const say = (file, msg) => problems.push(`${relative(ROOT, file)}: ${msg}`);

function walk(dir, pred = () => true) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "node_modules" ? [] : walk(p, pred);
    return pred(p) ? [p] : [];
  });
}

const stripComments = (text, ext) =>
  ext === ".css" ? text.replace(/\/\*[\s\S]*?\*\//g, "") : text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

// 1. Scripts parse.
const scripts = [...walk(join(ROOT, "src"), (p) => p.endsWith(".js")), ...walk(join(ROOT, "tools"), (p) => p.endsWith(".mjs")), ...walk(join(ROOT, "tests"), (p) => p.endsWith(".mjs"))];
for (const file of scripts) {
  const rel = relative(ROOT, file);
  if (CLASSIC.has(rel)) {
    try {
      new vm.Script(readFileSync(file, "utf8"), { filename: rel });
    } catch (e) {
      say(file, `does not parse as a classic script: ${e.message}`);
    }
  } else {
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (r.status !== 0) say(file, `does not parse: ${r.stderr.trim().split("\n").slice(0, 4).join(" ")}`);
  }
}

// 2 and 3. Colours and custom properties, in everything hand-written.
const contract = JSON.parse(readFileSync(join(ROOT, "contract/scheme.json"), "utf8"));
const schemeProps = new Set(contract.properties.map((p) => p.name));
const tokenProps = new Set();
const generatedTokens = join(ROOT, "generated/tokens.css");
if (existsSync(generatedTokens)) {
  for (const m of readFileSync(generatedTokens, "utf8").matchAll(/--([a-z0-9-]+)\s*:/g)) tokenProps.add(m[1]);
} else {
  problems.push("generated/tokens.css is missing: run `make build` with meridian-design beside this repository");
}
const known = (name) => schemeProps.has(name) || tokenProps.has(name) || name in LOCAL_PROPERTIES;

const handWritten = walk(join(ROOT, "src"), (p) => /\.(css|js|html)$/.test(p));
for (const file of handWritten) {
  const ext = extname(file);
  const raw = readFileSync(file, "utf8");
  let text = stripComments(raw, ext);
  if (ext === ".html") text = text.replace(/<!--[\s\S]*?-->/g, "");
  const cssish = ext === ".css" ? text : ext === ".html" ? [...text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>|style="([^"]*)"/g)].map((m) => m[1] || m[2]).join("\n") : text;

  const colourPatterns = [
    [/(^|[\s:,("'`])#[0-9a-fA-F]{3,8}\b/g, "a hex colour"],
    [/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/g, "a colour function"],
  ];
  for (const [re, what] of relative(ROOT, file) in COLOUR_DATA ? [] : colourPatterns) {
    const source = ext === ".js" ? [...text.matchAll(/(["'`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).join("\n") : cssish;
    for (const m of source.matchAll(re)) {
      if (what === "a colour function" && m[1] === "color" && ext === ".js") continue;
      say(file, `${what} (${m[0].trim()}): use a scheme property, var(--…)`);
    }
  }
  for (const m of cssish.matchAll(/(?:^|[;{\s])(?:color|background(?:-color)?|border(?:-[a-z]+)?-color|fill|stroke|outline-color)\s*:\s*[^;}]*\b(white|black|red|green|blue|gray|grey|silver|navy|orange|yellow|purple)\b/gi)) {
    say(file, `a named colour (${m[1]}): use a scheme property, var(--…)`);
  }

  for (const m of raw.matchAll(/var\(\s*--([A-Za-z0-9-]+)/g)) {
    if (!known(m[1])) say(file, `var(--${m[1]}) is not a scheme property, a brand token or a listed local`);
  }
  if (ext === ".css") {
    for (const m of text.matchAll(/--([A-Za-z0-9-]+)\s*:/g)) {
      if (schemeProps.has(m[1])) say(file, `declares --${m[1]}, a scheme's colour: only a scheme stylesheet does`);
      else if (!known(m[1])) say(file, `declares --${m[1]}, which is not a token or a listed local`);
    }
  }
}

// 4. What is served reaches nowhere else.
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const dist = join(ROOT, "dist", pkg.version);
if (existsSync(dist)) {
  for (const file of walk(dist)) {
    const ext = extname(file);
    let text = readFileSync(file, "utf8");
    // Comments are not fetched; what the file does is what is checked.
    if (ext === ".html") text = text.replace(/<!--[\s\S]*?-->/g, "");
    else if (ext === ".css" || ext === ".js") text = stripComments(text, ext);
    for (const m of text.matchAll(/(?:https?:)?\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s"'`)<]*/g)) {
      if (m[0] === SVG_NS) continue;
      say(file, `names another origin (${m[0]}): the kit fetches nothing from elsewhere`);
    }
    for (const m of text.matchAll(/(?:href|src)\s*=\s*"(\/[^"]*)"|url\(\s*["']?(\/[^"')]*)|(?:from|import)\s*\(?\s*["'](\/[^"']*)["']/g)) {
      say(file, `an absolute path (${m[1] || m[2] || m[3]}): references are relative, so the kit works under any base`);
    }
    for (const m of text.matchAll(/(?:^|[;\s])import\s+(?:[^"';]*?from\s*)?["']([^"'./][^"']*)["']/gm)) {
      say(file, `a bare module specifier (${m[1]}): the kit has no import map and no CDN`);
    }
  }
} else {
  console.log(`lint: dist/${pkg.version}/ is not built; its reference check is skipped (make build)`);
}

if (problems.length) {
  console.error(`lint FAILED:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`lint OK: ${scripts.length} scripts parse; ${handWritten.length} hand-written files use only scheme properties and tokens${existsSync(dist) ? `; dist/${pkg.version}/ reaches nowhere else` : ""}`);

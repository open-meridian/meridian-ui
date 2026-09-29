// What the build serves: every reference relative and present, nothing from
// elsewhere, and the manifest a scheme is checked against.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, extname } from "node:path";
import { ROOT, contract, version } from "./helpers.mjs";

const DIST = join(ROOT, "dist", version());
const built = existsSync(DIST);
const skip = built ? false : "dist is not built (make test builds it first)";

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

function references(file, text) {
  const ext = extname(file);
  const refs = [];
  if (ext === ".html") {
    const body = text.replace(/<!--[\s\S]*?-->/g, "");
    // What the page loads: a component's src is its server's URL, not a file.
    for (const m of body.matchAll(/<(?:link|script|img|iframe)\b[^>]*?\s(?:href|src)="([^"#?]+)[^"]*"/g)) refs.push(m[1]);
  }
  if (ext === ".css") {
    const body = text.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of body.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) refs.push(m[1]);
  }
  if (ext === ".js") {
    for (const m of text.matchAll(/^\s*import\s+(?:[^"';]*?from\s*)?["']([^"']+)["']/gm)) refs.push(m[1]);
    for (const m of text.matchAll(/new URL\("([^"]+)"/g)) if (!m[1].includes("+")) refs.push(m[1]);
  }
  return refs;
}

test("every reference the kit makes is relative and resolves to a file it ships", { skip }, () => {
  let count = 0;
  for (const file of files(DIST)) {
    const text = readFileSync(file, "utf8");
    for (const ref of references(file, text)) {
      if (ref === "." || ref === "./") continue;
      assert.ok(!/^([a-z]+:|\/)/i.test(ref), `${relative(DIST, file)}: ${ref} is not relative`);
      // The theme applier's URLs are relative to the kit's base, which is where meridian.js is.
      const target = join(dirname(file), ref);
      assert.ok(existsSync(target), `${relative(DIST, file)}: ${ref} does not exist in the kit`);
      count++;
    }
  }
  assert.ok(count >= 15, `references were found (${count})`);
});

test("meridian.css puts the brand default scheme underneath, in a layer", { skip }, () => {
  const css = readFileSync(join(DIST, "meridian.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").trim();
  const lines = css.split("\n");
  assert.equal(lines[0], "@layer meridian.scheme, meridian.tokens, meridian.base, meridian.components;");
  assert.equal(lines[1], '@import url("schemes/default.css") layer(meridian.scheme);');
  assert.doesNotMatch(css, /--ink\s*:/, "no colour is declared outside a scheme");
});

test("the manifest lists what a scheme defines, and the schemes shipped", { skip }, () => {
  const m = JSON.parse(readFileSync(join(DIST, "scheme-contract.json"), "utf8"));
  const c = contract();
  assert.equal(m.kit_version, version());
  assert.deepEqual(m.properties.map((p) => p.name), c.properties.map((p) => p.name));
  assert.deepEqual(m.pairs, c.pairs);
  assert.deepEqual(m.thresholds, c.thresholds);
  assert.deepEqual(m.schemes.map((s) => s.id), ["default", "harbour"]);
  for (const s of m.schemes) assert.ok(existsSync(join(DIST, "schemes", `${s.id}.css`)));
});

test("the version is stamped where the kit names itself", { skip }, () => {
  for (const f of ["meridian.js", "gallery.html"]) {
    const text = readFileSync(join(DIST, f), "utf8");
    assert.doesNotMatch(text, /__KIT_VERSION__/, f);
    assert.match(text, new RegExp(version().replace(/\./g, "\\.")), f);
  }
});

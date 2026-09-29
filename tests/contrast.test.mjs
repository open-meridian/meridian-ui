// The scheme contract and its contrast check.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColour, contrastRatio, composite, checkScheme } from "../src/lib/contrast.js";
import { parseSchemeCss, renderSchemeCss, validSchemeId } from "../src/lib/scheme.js";
import { read, json, contract } from "./helpers.mjs";

test("colours parse, and anything else is refused", () => {
  assert.deepEqual(parseColour("#fff"), [255, 255, 255, 1]);
  assert.deepEqual(parseColour("#0E1330"), [14, 19, 48, 1]);
  assert.deepEqual(parseColour("#00000080").slice(0, 3), [0, 0, 0]);
  assert.ok(Math.abs(parseColour("#00000080")[3] - 128 / 255) < 1e-9);
  assert.deepEqual(parseColour("rgba(7, 11, 36, .55)"), [7, 11, 36, 0.55]);
  assert.deepEqual(parseColour("rgb(7 11 36 / 50%)"), [7, 11, 36, 0.5]);
  for (const bad of ["tomato", "var(--ink)", "#12", "hsl(0 0% 0%)", "", null]) assert.equal(parseColour(bad), null, String(bad));
});

test("ratios are WCAG 2's", () => {
  const white = parseColour("#ffffff");
  const black = parseColour("#000000");
  assert.equal(contrastRatio(white, black).toFixed(2), "21.00");
  assert.equal(contrastRatio(white, white), 1);
  assert.equal(contrastRatio(parseColour("#767676"), white).toFixed(2), "4.54");
  // A translucent fill is seen over what is under it.
  assert.deepEqual(composite([0, 0, 0, 0.5], [255, 255, 255, 1]), [127.5, 127.5, 127.5, 1]);
});

test("the contract is consistent: every pair names properties, every kind has a threshold", () => {
  const c = contract();
  const names = new Set(c.properties.map((p) => p.name));
  assert.equal(names.size, c.properties.length, "no property is listed twice");
  for (const p of c.properties) {
    assert.ok(c.groups[p.group], `--${p.name}'s group ${p.group} is described`);
    assert.ok(p.meaning, `--${p.name} has a meaning`);
    assert.ok(typeof p.brand === "string" || (p.brand.light && p.brand.dark), `--${p.name} has a brand token for each mode`);
  }
  for (const pair of c.pairs) {
    assert.ok(names.has(pair.fg) && names.has(pair.bg), `${pair.fg} on ${pair.bg}`);
    if (pair.over) assert.ok(names.has(pair.over));
    assert.ok(c.thresholds[pair.kind] > 0, `${pair.kind} has a threshold`);
    assert.ok(pair.where);
  }
  assert.deepEqual(c.thresholds, { text: 4.5, "large-text": 3, ui: 3 });
  for (const d of c.distinct) assert.ok(names.has(d.a) && names.has(d.b));
});

test("the brand default scheme passes every pair, in both modes", () => {
  const c = contract();
  const { scheme, problems } = parseSchemeCss(read("generated/schemes/default.css"));
  assert.deepEqual(problems, []);
  const result = checkScheme(scheme, c);
  assert.deepEqual(result.problems, [], result.problems.join("\n"));
  assert.equal(result.results.length, c.pairs.length * c.modes.length, "every pair was measured in each mode");
  assert.ok(result.results.every((r) => r.pass));
});

test("the sample scheme passes, and renders to the same template", () => {
  const c = contract();
  const harbour = json("schemes/harbour.json");
  assert.ok(checkScheme(harbour, c).ok);
  const round = parseSchemeCss(renderSchemeCss("harbour", harbour, c));
  assert.deepEqual(round.problems, []);
  for (const mode of c.modes) for (const p of c.properties) assert.equal(round.scheme[mode][p.name], harbour[mode][p.name]);
});

test("a deliberately bad scheme fails, naming each failing pair", () => {
  const { scheme } = parseSchemeCss(read("tests/fixtures/bad-scheme.css"));
  const result = checkScheme(scheme, contract());
  assert.equal(result.ok, false);
  const text = result.problems.join("\n");
  const expect = [
    /^light: --ink-faint on --page is \d\.\d\d:1, below 4\.5:1 for text \(hints on the page\)$/m,
    /^light: --ink-faint on --card is \d\.\d\d:1, below 4\.5:1 for text/m,
    /^light: --buy and --sell differ by 0\.0 \(CIE76\), below 20: buy and sell must stay distinguishable$/m,
    /^dark: --primary-ink on --primary is 1\.00:1, below 4\.5:1 for text \(the primary button\)$/m,
    /^dark: --violet-wash is missing$/m,
    /^dark: --accent is "tomato", not a colour the check reads/m,
  ];
  for (const re of expect) assert.match(text, re);
  // Nothing that passes is named.
  assert.doesNotMatch(text, /--ink on --card/);
  assert.equal(result.problems.length, expect.length, text);
});

test("a stylesheet out of the template's shape is reported", () => {
  const c = contract();
  const harbour = json("schemes/harbour.json");
  const css = renderSchemeCss("harbour", harbour, c);
  const drifted = css.replace(/(:root\[data-om-mode="dark"\] \{[\s\S]*?--ink: )#e2f1f2/, "$1#ffffff");
  assert.match(parseSchemeCss(drifted).problems.join("\n"), /--ink differs between the two dark blocks/);
  const noMedia = css.replace(/@media[\s\S]*?\n\}\n/, "");
  assert.match(parseSchemeCss(noMedia).problems.join("\n"), /prefers-color-scheme: dark/);
});

test("scheme ids are safe as a path segment", () => {
  for (const ok of ["default", "harbour", "desk-2", "a"]) assert.ok(validSchemeId(ok), ok);
  for (const bad of ["../x", "Harbour", "a/b", "", "-x", "x".repeat(65), "a.css"]) assert.ok(!validSchemeId(bad), bad);
});

test("tools/check-scheme.mjs passes the default and fails the bad scheme, naming pairs", async () => {
  const { spawnSync } = await import("node:child_process");
  const { join } = await import("node:path");
  const { ROOT } = await import("./helpers.mjs");
  const run = (f) => spawnSync(process.execPath, [join(ROOT, "tools/check-scheme.mjs"), join(ROOT, f)], { encoding: "utf8" });
  const good = run("generated/schemes/default.css");
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /OK, \d+ pairs pass/);
  const bad = run("tests/fixtures/bad-scheme.css");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAILS/);
  assert.match(bad.stdout, /dark: --primary-ink on --primary is 1\.00:1/);
});

// The generator reproduces tokens.json's values exactly: every colour the
// contract maps, in both modes; every spacing, radius and shadow; every type
// style. Run against a synthetic fixture always, and against meridian-design's
// real tokens where they are beside this repository (or mounted for `make test`).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { renderTokensCss, renderDefaultScheme, TYPE_SELECTORS } from "../tools/build.mjs";
import { parseSchemeCss } from "../src/lib/scheme.js";
import { ROOT, contract, brandTokensPath } from "./helpers.mjs";

function tokenOf(tokens, family, name) {
  const t = tokens[family].tokens.find((x) => x.name === name);
  assert.ok(t, `${family} token ${name} exists`);
  return t.value;
}

function modeValue(v, mode) {
  return typeof v === "string" ? v : v[mode];
}

/** The custom properties declared in generated/tokens.css, per mode, read back. */
function readTokensCss(css) {
  const { scheme, problems } = parseSchemeCss(css.replace(/@layer meridian\.base[\s\S]*$/, "").replace(/^[\s\S]*?@layer meridian\.tokens \{/, "").replace(/\}\s*$/, ""));
  return { ...scheme, problems };
}

function assertReproduces(tokens, label) {
  const c = contract();
  const { css, scheme } = renderDefaultScheme(tokens, c);
  const back = parseSchemeCss(css, c);
  assert.deepEqual(back.problems, [], `${label}: the default scheme is in the template's shape`);
  for (const mode of c.modes) {
    for (const p of c.properties) {
      const tokenName = typeof p.brand === "string" ? p.brand : p.brand[mode];
      const want = modeValue(tokenOf(tokens, "color", tokenName), mode);
      assert.equal(back.scheme[mode][p.name], want, `${label}: --${p.name} in ${mode} is token ${tokenName}`);
      assert.equal(scheme[mode][p.name], want);
    }
    assert.equal(Object.keys(back.scheme[mode]).length, c.properties.length, `${label}: ${mode} declares exactly the contract's properties`);
  }

  const tcss = renderTokensCss(tokens);
  const read = readTokensCss(tcss);
  for (const family of ["spacing", "radius", "shadow"]) {
    for (const t of tokens[family].tokens) {
      assert.equal(read.light[t.name], modeValue(t.value, "light"), `${label}: --${t.name} in light`);
      const dark = modeValue(t.value, "dark");
      if (dark !== modeValue(t.value, "light")) assert.equal(read.dark[t.name], dark, `${label}: --${t.name} in dark`);
      else assert.equal(read.dark[t.name], undefined, `${label}: --${t.name} is not redeclared in dark`);
    }
  }
  assert.equal(read.light.sans, tokens.type.families.sans);
  assert.equal(read.light.mono, tokens.type.families.mono);

  const styles = new Map(tokens.type.groups.flatMap((g) => g.styles.map((s) => [s.name, { ...s, family: g.family }])));
  for (const [name, selector] of Object.entries(TYPE_SELECTORS)) {
    const s = styles.get(name);
    const rule = tcss.split("\n").find((l) => l.trim().startsWith(`${selector} {`));
    assert.ok(rule, `${label}: a rule for ${name}`);
    assert.ok(rule.includes(`font-size: ${s.fontSize};`), `${label}: ${name} font-size`);
    assert.ok(rule.includes(`line-height: ${s.lineHeight};`), `${label}: ${name} line-height`);
    assert.ok(rule.includes(`font-weight: ${s.fontWeight};`), `${label}: ${name} font-weight`);
    assert.ok(rule.includes(`font-family: var(--${s.family});`), `${label}: ${name} family`);
    if (s.letterSpacing) assert.ok(rule.includes(`letter-spacing: ${s.letterSpacing};`), `${label}: ${name} letter-spacing`);
  }
  return { css, tcss };
}

test("the generator reproduces a tokens file exactly (synthetic fixture)", () => {
  const tokens = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/tokens.json"), "utf8"));
  assertReproduces(tokens, "fixture");
});

test("a property mapped to a token tokens.json lacks is an error, not a gap", () => {
  const tokens = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/tokens.json"), "utf8"));
  tokens.color.tokens = tokens.color.tokens.filter((t) => t.name !== "line-strong");
  assert.throws(() => renderDefaultScheme(tokens, contract()), /line-strong/);
});

const brand = brandTokensPath();

test("the generator reproduces meridian-design's tokens.json exactly", { skip: brand ? false : "meridian-design is not beside this repository (private); CI builds from generated/" }, () => {
  const tokens = JSON.parse(readFileSync(brand, "utf8"));
  const { css, tcss } = assertReproduces(tokens, "brand");
  // And what is committed is what they generate: check-brand reads these files.
  assert.equal(readFileSync(join(ROOT, "generated/schemes/default.css"), "utf8"), css, "generated/schemes/default.css is fresh");
  assert.equal(readFileSync(join(ROOT, "generated/tokens.css"), "utf8"), tcss, "generated/tokens.css is fresh");
});

test("the committed generated files exist and are in the template's shape", () => {
  for (const f of ["generated/tokens.css", "generated/schemes/default.css"]) assert.ok(existsSync(join(ROOT, f)), f);
  const back = parseSchemeCss(readFileSync(join(ROOT, "generated/schemes/default.css"), "utf8"), contract());
  assert.deepEqual(back.problems, []);
});

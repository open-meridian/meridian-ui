// A colour scheme as data and as the stylesheet the dashboard serves at
// /.meridian/ui/<version>/schemes/<id>.css. No DOM and no dependencies: the
// build renders the brand default with it, the tests and tools/check-scheme.mjs
// read stylesheets back with it, and the dashboard renders the same template.

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A scheme id is lower-case letters, digits and hyphens, at most 64. */
export function validSchemeId(id) {
  return typeof id === "string" && ID.test(id);
}

/** The brand default scheme, { light, dark }, from tokens.json and the contract. */
export function brandScheme(tokens, contract) {
  const byName = new Map(tokens.color.tokens.map((t) => [t.name, t.value]));
  const scheme = {};
  for (const mode of contract.modes) {
    scheme[mode] = {};
    for (const p of contract.properties) {
      const token = typeof p.brand === "string" ? p.brand : p.brand[mode];
      const value = byName.get(token);
      if (value === undefined) throw new Error(`--${p.name}: tokens.json has no colour token "${token}"`);
      scheme[mode][p.name] = typeof value === "string" ? value : value[mode];
    }
  }
  return scheme;
}

function block(selector, values, names, indent) {
  const pad = " ".repeat(indent);
  const lines = names.map((n) => `${pad}  --${n}: ${values[n]};`);
  return `${pad}${selector} {\n${lines.join("\n")}\n${pad}}`;
}

/** The stylesheet for a scheme: light on :root; dark for mode 'system' on a
 * dark system, and for mode 'dark'. */
export function renderSchemeCss(id, scheme, contract, heading = "") {
  if (!validSchemeId(id)) throw new Error(`not a scheme id: ${JSON.stringify(id)}`);
  const names = contract.properties.map((p) => p.name);
  const intro = heading ? `/* ${heading.replace(/\*\//g, "* /")} */\n` : "";
  return (
    intro +
    block(":root", scheme.light, names, 0) +
    "\n\n@media (prefers-color-scheme: dark) {\n" +
    block(':root:not([data-om-mode="light"])', scheme.dark, names, 2) +
    "\n}\n\n" +
    block(':root[data-om-mode="dark"]', scheme.dark, names, 0) +
    "\n"
  );
}

function declarationsIn(body) {
  const out = {};
  for (const m of body.matchAll(/--([A-Za-z0-9-]+)\s*:\s*([^;}]+)/g)) out[m[1]] = m[2].trim();
  return out;
}

function blockAfter(text, re) {
  // The balanced { ... } after the first match of re: its body, and where the
  // whole rule (from the match to its closing brace) starts and ends.
  const m = re.exec(text);
  if (!m) return null;
  const open = text.indexOf("{", m.index + m[0].length - 1);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return { body: text.slice(open + 1, i), from: m.index, to: i + 1 };
  }
  return null;
}

/**
 * Read a scheme stylesheet back into { light, dark }, with problems for a
 * stylesheet that is not in the template's shape (a missing block, or a
 * dark value that differs between its two declarations).
 */
export function parseSchemeCss(text) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const problems = [];
  const media = blockAfter(css, /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/);
  const explicit = blockAfter(css, /:root\[data-om-mode="dark"\]\s*\{/);
  // Light is every :root block outside the two dark rules.
  const cut = [media, explicit].filter(Boolean).sort((a, b) => b.from - a.from);
  let lightText = css;
  for (const c of cut) lightText = lightText.slice(0, c.from) + lightText.slice(c.to);
  const light = {};
  for (const m of lightText.matchAll(/(^|})\s*:root\s*\{([^}]*)\}/g)) Object.assign(light, declarationsIn(m[2]));
  const dark = explicit ? declarationsIn(explicit.body) : {};
  if (!media) problems.push('no @media (prefers-color-scheme: dark) block: mode "system" would not follow a dark system');
  if (!explicit) problems.push(':root[data-om-mode="dark"] block is missing: mode "dark" would not apply');
  if (media && explicit) {
    const fromMedia = declarationsIn(media.body);
    for (const name of new Set([...Object.keys(fromMedia), ...Object.keys(dark)])) {
      if (fromMedia[name] !== dark[name]) {
        problems.push(`--${name} differs between the two dark blocks (${fromMedia[name]} and ${dark[name]})`);
      }
    }
  }
  return { scheme: { light, dark }, problems };
}

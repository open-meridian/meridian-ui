// A colour scheme as data and as the stylesheet the dashboard serves at
// /.meridian/ui/<version>/schemes/<id>.css. No DOM and no dependencies: the
// build renders the brand default with it, the tests and tools/check-scheme.mjs
// read stylesheets back with it, and the dashboard renders the same template.

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The direction properties a convention swaps, as [a, b] pairs ([] for green-up). */
export function directionSwaps(contract, convention) {
  const d = contract.direction;
  if (!d || convention === d.default) return [];
  if (!d.conventions.includes(convention)) throw new Error(`not a direction convention: ${JSON.stringify(convention)}`);
  return d.swap;
}

/** The properties a convention redeclares, in the contract's order. */
function swappedNames(contract, convention) {
  const swapped = new Set(directionSwaps(contract, convention).flat());
  return contract.properties.map((p) => p.name).filter((n) => swapped.has(n));
}

/**
 * One mode's values as a convention draws them: under red-up each direction
 * pair is swapped (buy takes sell's colour and sell takes buy's), and every
 * other property, the status colours included, is unchanged.
 */
export function underConvention(values, contract, convention) {
  const out = { ...values };
  for (const [a, b] of directionSwaps(contract, convention)) {
    out[a] = values[b];
    out[b] = values[a];
  }
  return out;
}

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

/** The three selectors each convention's values are declared under, per mode. */
function selectors(contract) {
  const d = contract.direction;
  const out = [{
    convention: d ? d.default : "green-up",
    light: ":root",
    media: ':root:not([data-om-mode="light"])',
    dark: ':root[data-om-mode="dark"]',
  }];
  for (const c of d ? d.conventions.filter((x) => x !== d.default) : []) {
    const attr = `[${d.attribute}="${c}"]`;
    out.push({
      convention: c,
      light: `:root${attr}`,
      media: `:root${attr}:not([data-om-mode="light"])`,
      dark: `:root[data-om-mode="dark"]${attr}`,
    });
  }
  return out;
}

/** The stylesheet for a scheme: light on :root; dark for mode 'system' on a
 * dark system, and for mode 'dark'. Then each other direction convention's
 * blocks in the same three places, declaring only the properties it swaps:
 * later and more specific, so they win where their attribute is set. */
export function renderSchemeCss(id, scheme, contract, heading = "") {
  if (!validSchemeId(id)) throw new Error(`not a scheme id: ${JSON.stringify(id)}`);
  const all = contract.properties.map((p) => p.name);
  const intro = heading ? `/* ${heading.replace(/\*\//g, "* /")} */\n` : "";
  return (
    intro +
    selectors(contract)
      .map((s, i) => {
        const names = i === 0 ? all : swappedNames(contract, s.convention);
        const light = underConvention(scheme.light, contract, s.convention);
        const dark = underConvention(scheme.dark, contract, s.convention);
        return (
          block(s.light, light, names, 0) +
          "\n\n@media (prefers-color-scheme: dark) {\n" +
          block(s.media, dark, names, 2) +
          "\n}\n\n" +
          block(s.dark, dark, names, 0) +
          "\n"
        );
      })
      .join("\n")
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

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Read a scheme stylesheet back into { light, dark }, with problems for a
 * stylesheet that is not in the template's shape (a missing block, or a
 * dark value that differs between its two declarations). Given the contract,
 * it also holds each other direction convention's blocks to the template:
 * present in all three places, and exactly the swap of the scheme's values.
 */
export function parseSchemeCss(text, contract = null) {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const problems = [];
  const media = blockAfter(css, /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{(?=\s*:root:not\(\[data-om-mode="light"\]\)\s*\{)/);
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
  if (contract) {
    for (const s of selectors(contract).slice(1)) {
      const names = swappedNames(contract, s.convention);
      const found = {
        light: blockAfter(css, new RegExp(`${escape(s.light)}\\s*\\{`)),
        media: blockAfter(css, new RegExp(`@media\\s*\\(\\s*prefers-color-scheme\\s*:\\s*dark\\s*\\)\\s*\\{(?=\\s*${escape(s.media)}\\s*\\{)`)),
        dark: blockAfter(css, new RegExp(`${escape(s.dark)}\\s*\\{`)),
      };
      const want = { light: underConvention(light, contract, s.convention), dark: underConvention(dark, contract, s.convention) };
      for (const [where, mode] of [["light", "light"], ["media", "dark"], ["dark", "dark"]]) {
        const sel = where === "media" ? `@media (prefers-color-scheme: dark) { ${s.media} }` : s[where];
        if (!found[where]) {
          problems.push(`${sel} block is missing: the ${s.convention} convention would not swap ${names.join(", ")}`);
          continue;
        }
        const got = declarationsIn(found[where].body);
        for (const name of names) {
          if (got[name] !== want[mode][name]) {
            problems.push(`${sel}: --${name} is ${got[name]}, not the ${s.convention} swap of the scheme (${want[mode][name]})`);
          }
        }
      }
    }
  }
  return { scheme: { light, dark }, problems };
}

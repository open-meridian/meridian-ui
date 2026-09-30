// Shared by the tests: where things are, and the tokens to test against.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const read = (p) => readFileSync(join(ROOT, p), "utf8");
export const json = (p) => JSON.parse(read(p));
export const contract = () => json("contract/scheme.json");
export const version = () => json("package.json").version;

/** meridian-design's tokens.json when it is beside this repository (or mounted), else null. */
export function brandTokensPath() {
  const candidates = [process.env.MERIDIAN_BRAND_TOKENS, join(ROOT, "../meridian-design/brand/tokens.json")].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

/** Let promises and zero-delay timers run. */
export async function settle(times = 5) {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
}

/** Put `html` in the document's body as a browser inserts parsed markup: each
 * element with its children already in it when it is connected. (happy-dom's
 * innerHTML connects an element before its children are appended, as only a
 * browser still parsing the page would.) */
export function put(html) {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  document.body.replaceChildren(...holder.childNodes);
  return document.body.firstElementChild;
}

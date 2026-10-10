// The README's Patterns are the gallery's patterns page: each html block
// under "## Patterns" is the block between that page's two comments of the
// same place, in the same order, so what the README gives an SDK's helpers to
// write is what the gallery shows the kit drawing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { read } from "./helpers.mjs";

/** Lines trimmed, blank ones dropped: whitespace between tags is not part of a pattern. */
const normal = (text) => text.split("\n").map((l) => l.trim()).filter(Boolean).join("\n");

function readmePatterns() {
  const readme = read("README.md");
  const section = readme.slice(readme.indexOf("\n## Patterns\n"), readme.indexOf("\n## The theme: the frame's message\n"));
  return [...section.matchAll(/```html\n([\s\S]*?)\n```/g)].map((m) => normal(m[1]));
}

function galleryPatterns() {
  const page = read("src/gallery/patterns.html");
  return [...page.matchAll(/<!-- pattern: ([a-z-]+) -->\n([\s\S]*?)\n<!-- \/pattern -->/g)].map((m) => ({ name: m[1], block: normal(m[2]) }));
}

test("each of the README's patterns is the gallery's, in order", () => {
  const readme = readmePatterns();
  const gallery = galleryPatterns();
  assert.equal(readme.length, 15, "the head, status, action, notice, badge, tiles, a moment, grid, entry grid, one-line rows, pager, search, gated fields, nothing here, empty");
  assert.deepEqual(gallery.map((g) => g.name), ["the-head", "status", "action", "notice", "badge", "tiles", "a-moment", "grid", "entry-grid", "one-line-rows", "pager", "search", "gated-fields", "nothing-here", "empty"]);
  for (let i = 0; i < readme.length; i++) assert.equal(gallery[i].block, readme[i], gallery[i].name);
});

test("every pattern's markup is shown under it, and the grid's JSON parses", () => {
  const page = read("src/gallery/patterns.html");
  for (const { name } of galleryPatterns()) assert.match(page, new RegExp(`data-markup="${name}"`), name);
  const grid = galleryPatterns().find((g) => g.name === "grid").block;
  const declared = JSON.parse(grid.match(/<script type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(declared.columns.map((c) => c.key), ["instrument", "quantity", "state"]);
  assert.equal(declared.rows.length, 2);
  const entry = galleryPatterns().find((g) => g.name === "entry-grid").block;
  const given = JSON.parse(entry.match(/<script type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(given.columns.map((c) => c.key), ["quantity", "cost", "acquired"]);
  assert.deepEqual(given.errors.map((e) => e.path), ["lots[1].acquired"]);
});

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
  assert.equal(readme.length, 18, "the head, status, action, notice, badge, tiles, a moment, grid, entry grid, one-line rows, facts, pager, search, gated fields, prepare, nothing here, empty, next step");
  assert.deepEqual(gallery.map((g) => g.name), ["the-head", "status", "action", "notice", "badge", "tiles", "a-moment", "grid", "entry-grid", "one-line-rows", "facts", "pager", "search", "gated-fields", "prepare", "nothing-here", "empty", "next-step"]);
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

test("facts are a one-line table of row headers, each row's whole a click away; a next step links the host's tab by name", () => {
  const facts = galleryPatterns().find((g) => g.name === "facts").block;
  const rows = [...facts.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((m) => m[1]);
  assert.match(facts, /^<table class="one-line" aria-label="Key">/, "named for a screen reader; no caption, which undoes the fixed widths");
  assert.doesNotMatch(facts, /<thead>/, "facts have no head");
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.match(row, /^<th scope="row">[^<]+<\/th><td>/, "the label is a row header");
    assert.match(row, /<td class="more"><details class="row-detail" name="key">/, "the whole a click away");
  }
  const next = galleryPatterns().find((g) => g.name === "next-step").block;
  assert.match(next, /^<div class="empty-state"><strong>No key yet<\/strong>/, "Empty's title");
  assert.match(next, /<a data-om-opens="settings">Settings<\/a>/, "a link naming the host's tab, with no href");
  assert.doesNotMatch(next, /href=/);
});

test("Prepare is a submit of the act's own form with the reserved field, before the act's submit", () => {
  const block = galleryPatterns().find((g) => g.name === "prepare").block;
  assert.match(block, /^<form method="post" action="[^"]+">/);
  assert.match(block, /<input type="hidden" name="csrf" value="…">/, "the page's own token");
  assert.match(block, /<button type="submit" name="prepare" value="1">Prepare<\/button><button class="primary">/, "Prepare, then the act's submit, as core draws them");
});

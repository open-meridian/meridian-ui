# Changelog

What each release of the kit adds. A 0.x release only adds: nothing is
removed or renamed. Releases before 0.13.0 are described in the README's
opening and in each release's commit ("Kit 0.12.0: …").

## 0.13.0 (v27)

The admin sidebar, as a kit component (meridian-design rulings 447 to 451).

- **`om-sidebar`**: a grouped left sidebar of plain links, its groups and
  items given as data (`<script type="application/json">` or the `groups`
  property), so a group or an item is added without changing the element.
  The current item is marked `aria-current="page"`: by the `current`
  attribute, by the data's `current`, or by the page's address (path, query
  and fragment, with `also` for an item of several addresses), again on every
  `hashchange`.
- **Collapses to icons on a desktop**, the person's choice remembered in the
  browser (`localStorage`, `om-sidebar:<remember>`), storage refused changing
  only the remembering; the page's `collapsed` is the default.
- **A drawer below 48rem (768px)**: a one-line bar (Menu and the current
  item); Menu opens the sidebar as a modal dialog from the left, focus on the
  current item; Escape, a click outside, its close button or a link followed
  closes it, focus back on Menu.
- **`.om-shell` and `.om-shell-main`**: the sidebar beside the page, which
  keeps its own head and tab row (a plugin's Manage page inside the shell,
  ruling 450). `--om-sidebar-top` sits the sticky sidebar under a host's
  header.
- **`lib/icons.js`**: the kit's stroked icons, inline and in the element's
  own colour. The platform's sixteen names, drawn the same, and ten added for
  the sidebar: `package`, `route`, `key`, `bot`, `link`, `wallet`, `layers`,
  `lock`, `list`, `clock`.
- The gallery's `sidebar.html` (the 448 groups) and `sidebar-manage.html`
  (a Manage page in the shell); `make fit` holds both to one screen and
  checks the sidebar at 1280, 582 and 375 px, light and dark, by keyboard.

# Changelog

What each release of the kit adds. A 0.x release only adds: nothing is
removed or renamed. Releases before 0.13.0 are described in the README's
opening and in each release's commit ("Kit 0.12.0: …").

## 0.15.0

An entry grid's instrument column brings in what the page does not hold yet,
as the picker does, and neither shows a record's ID (meridian-design ruling
786, for the one search everywhere a person picks an instrument, 727).

- **A bring-in hook on `om-entry-grid`**: the `bring-in` attribute or the
  `bringIn` property, as `om-instrument-picker`'s (0.14.0). With one, an
  instrument cell's search asks for candidates and lists them with the held
  results, the record's ID shown for neither; choosing one brings it in, the
  cell holding the submit ("The instrument is still being brought in") until
  the hook resolves to the instrument the page holds, whose ID then posts. A
  refusal is the cell's problem, saying why, and fires `om-error`; typing in
  the cell abandons it. `bringing` is true while any cell is bringing one in.
- **An instrument is named by its name and ticker** (`instrumentLabel`):
  the ticker -- else the first identifier -- in brackets, with the exchange's
  MIC where known (`Apple Inc. (AAPL · XNAS)`), never the record's ID; a
  record with no name is named by its ticker. An entry grid's instrument cell
  no longer puts the ID in its title beside the name.

## 0.14.0

The instrument picker brings in what the page does not hold yet
(meridian-design ruling 774, for the one-search picker of rulings 727 and 761).

- **A bring-in hook on `om-instrument-picker`**: the `bringIn` property, a
  function resolving to the instrument the page holds, or the `bring-in`
  attribute, a URL on the page's origin the kit POSTs the chosen candidate to
  (`{ "candidate": … }`, answered `{ "instrument": … }`). No pick tokens: the
  candidate is the search's result itself.
- **Candidates in the search's answer**: a result marked `"candidate": true`
  with an empty `instrument_id` is listed only by a picker with a hook, in one
  list with the held ones, the record's ID shown for neither. Without a hook,
  and in an entry grid's instrument column, they are dropped as before.
- **Until it is brought in** the value is empty and the control invalid, so
  the form does not submit; then `om-select` fires with the held record. A
  refusal says why and fires `om-error`; clearing aborts the hook.
- The keyboard is unchanged (arrows, Enter, Escape); a `role="status"` line
  announces bringing in, chosen, or why not, and the chip is `aria-busy`
  meanwhile.
- `lib/instruments.js`: `findInstruments(…, { candidates })`, `isCandidate`,
  `bringInstrumentIn`, and `instrumentOption(…, { ids })`.

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
  item); Menu opens the sidebar as a modal dialog from the left, without the
  desktop's collapse button (hidden, and from the accessibility tree), focus
  on the current item; Escape, a click outside, its close button or a link followed
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

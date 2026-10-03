# meridian-ui

Open Meridian's plugin UI kit. A plugin's page links it and looks like Open
Meridian with no design work: the brand's type, spacing, radii and shadows;
the person's colour scheme, light or dark, and their market-direction
convention (green-up or red-up), handed over by the dashboard's frame; the platform's components in CSS; and web components for what trading
pages need: a data grid (with a high-rate mode for streams, and a layout for a
phone), a grid of typed inputs a person enters rows in, charts, an as-of control and an as-of moment, a status dot, an instrument picker, a
live feed that never misses a change, resizable, rearrangeable panels, and the
map a plugin links its external accounts with.

It is framework-free: CSS and custom elements, used the same way from plain
HTML, React, Vue or Svelte. It has no runtime dependencies and loads nothing
from anywhere but itself. The design is meridian-design's
`spec/plugin-pages-share-one-kit.md`. This is release 0.9.0; the guide to
building a plugin's page with it is at
[open-meridian.dev](https://open-meridian.dev/how-to/build-a-plugin-page/).

- [Linking the kit](#linking-the-kit)
- [Never raw colours](#never-raw-colours)
- [CSS components](#css-components)
- [Web components](#web-components): [data without script](#data-without-script), [om-grid](#om-grid) (and its [rich cells](#rich-cells), [narrow layouts](#narrow-layouts) and [high-rate mode](#high-rate-mode)), [om-chart](#om-chart), [om-asof](#om-asof), [om-moment](#om-moment), [om-status](#om-status), [om-instrument-picker](#om-instrument-picker), [om-live](#om-live), [om-panels](#om-panels), [om-account-map](#om-account-map), [om-entry-grid](#om-entry-grid)
- [Patterns](#patterns): [the head](#the-head), [status](#status), [action](#action), [notice](#notice), [badge](#badge), [tiles](#tiles), [a moment](#a-moment), [grid](#grid), [entry grid](#entry-grid), [nothing here](#nothing-here), [empty](#empty)
- [The theme: the frame's message](#the-theme-the-frames-message)
- [The frame: seamless](#the-frame-seamless)
- [The scheme contract](#the-scheme-contract)
- [Building and checking](#building-and-checking)
- [Releasing](#releasing)

## Linking the kit

The dashboard serves the kit at `/.meridian/ui/<version>/` on every plugin
host, so it is on the plugin's own origin. Link its stylesheet and script in
`<head>`; the script is a small classic script, so the theme applies before
first paint, and it loads the components beside it.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Positions</title>
  <link rel="stylesheet" href="/.meridian/ui/0.9.0/meridian.css">
  <script src="/.meridian/ui/0.9.0/meridian.js"></script>
</head>
<body>
  <main class="page">
    <header class="page-head">
      <div><h1>Positions</h1><p>Every account this plugin reads.</p></div>
      <om-live src="events" snapshot="positions.json" for="positions"></om-live>
    </header>
    <section class="panel padded">
      <om-grid id="positions" row-key="position_id" sort="market_value:desc"></om-grid>
    </section>
  </main>
  <script type="module">
    await customElements.whenDefined("om-grid");
    document.getElementById("positions").columns = [
      { key: "symbol", label: "Instrument" },
      { key: "quantity", label: "Quantity", type: "decimal", group: true },
      { key: "market_value", label: "Market value", type: "decimal", group: true },
      { key: "day_pnl", label: "Day P&L", type: "decimal", group: true, tone: "sign" },
    ];
  </script>
</body>
</html>
```

The version in the path is the deployment's, so a brand change reaches every
page at once; a page may pin the version it was built against. The frame draws
the plugin's name, the way back to the dashboard and the person: a page draws
only its content, inside `.page`. Where the dashboard frames a page seamlessly
(its admin view's tabs), it draws the page's heading and tab row too, and the
kit drops the page's own: see [the frame: seamless](#the-frame-seamless).

The kit is plain files under one directory, and every reference inside it is
relative, so it works under any base path:

| File | What |
|---|---|
| `meridian.css` | The brand default scheme (as a cascade layer underneath), the brand's tokens, the base and the components |
| `meridian.js` | The theme applier; loads `components/index.js` |
| `components/*.js` | One module per component; import one alone if you prefer |
| `lib/*.js` | Decimals, the same-origin rule, schemes and the contrast check |
| `schemes/<id>.css` | A colour scheme: `default` is the brand's; the dashboard serves an admin's beside it |
| `scheme-contract.json` | What a scheme defines and the pairs it must pass |
| `gallery.html` | Every component, light and dark, in each scheme shipped, green-up or red-up; the sample page framed seamlessly by a stand-in host (`gallery/host.html`) beside it on its own; a plugin's account links page (`gallery/accounts.html`, tags and JSON with no script of its own) at the gallery's width and at 390px, on its own and framed; and the [patterns](#patterns) (`gallery/patterns.html`), each with its markup, on its own and framed |

The kit's CSS is in cascade layers (`meridian.scheme`, `meridian.tokens`,
`meridian.base`, `meridian.components`), so a page's own rules win without a
specificity contest.

**From a framework.** The components are custom elements: render them like
any element, set their data as properties, and listen for their events.
React 19 sets properties on custom elements directly; before 19, set
`columns`, `rows` and `series` through a ref. Vue: `<om-grid :columns.prop="cols">`
(and `compilerOptions.isCustomElement: (t) => t.startsWith("om-")`). Svelte
sets properties by default. A framework must not render children inside an
`om-*` element: each one draws its own (a page's HTML may put its declared
JSON and what it shows without the kit there, which the element replaces).

**Versions.** A 0.x release only adds: nothing is removed or renamed, so a page
pinned to an earlier 0.x keeps working on the newest, which the dashboard
serves to any 0.x request. 0.2.0 added the seamless frame (see
[the frame: seamless](#the-frame-seamless)). 0.3.0 added `om-account-map`, `om-moment`, the
grid's declared JSON, rich cells and narrow layouts, list rows that wrap,
options, the field row and a select as tall as an input. 0.4.0 added header
actions: a framed page's head buttons drawn in the host's header (see
[the frame: seamless](#the-frame-seamless)). 0.5.0 made `om-account-map` a
dense table for thousands of accounts: search, filters, grouping, pages, a
chooser found by typing, suggestions, and several links in one form
(`link-several`), with the data's new fields `number`, `connection` and
`connection_id` (all optional). 0.6.0 added `om-status`, a status dot with
its note on hover, focus or a tap, and to `om-account-map` each account's
optional `status` and `values`, a Status column and a filter by state. 0.7.0
added the header status: a framed page's head `om-status` marked
`data-om-header` drawn by the host beside the plugin's name, and a head left
with nothing to show once the host draws its parts dropped whole (see
[the frame: seamless](#the-frame-seamless)). 0.7.1 added `om-account-map`'s
`no-new-account`, for a page whose viewer may link to an existing account
but not create one. 0.8.0 added icon buttons: a button marked
`data-om-icon="refresh"` is drawn as a circular arrow, its words its name,
and a header action so marked is drawn by the host as that icon (see
[the frame: seamless](#the-frame-seamless)). 0.9.0 added `om-entry-grid`, a
table of typed inputs a person enters rows in, posted with the page's own
form, the server's messages placed on their cells by path, a spreadsheet's
paste and a CSV in a dialog (see [om-entry-grid](#om-entry-grid)); and
`addDecimals` to `lib/decimal.js`.

## Never raw colours

Every colour on a page is a scheme property: `var(--ink)`, `var(--accent)`,
`var(--buy)`. Never a hex, an `rgb()` or a colour name, in CSS, in inline
styles or in script. The person chooses the scheme and the mode, the
deployment's administrator may add schemes, and a raw colour is one that no
scheme can change and no contrast check has seen. The properties are listed
under [the scheme contract](#the-scheme-contract).

Type, spacing, radii and shadows are the brand's: `var(--space-1)` to
`var(--space-10)` (4, 8, 12, 16, 20, 24, 32, 40 px), `var(--radius-sm)`,
`var(--radius)`, `var(--radius-lg)`, `var(--radius-pill)`, `var(--shadow)`,
`var(--shadow-pop)`, `var(--sans)`, `var(--mono)`.

## CSS components

The platform's classes, so a page reads like the platform. A page that used
the SnapTrade page's names (`page`, `panel`, `badge`, `notice`, `button`)
keeps them.

| Class | What |
|---|---|
| `.page` (`.wide`) | The content column. `.page-head` (or `.pagehead`) with `.actions`; `.section-head` |
| `.panel`, `.card` | A card on page. `.panel.padded` pads it; `.panel.narrow`; `.panel-section` is a divided section inside; `.list-row` rows with `.grow`, `.title`, `.meta` (the `.grow` text is never narrower than 16rem: where it and the row's actions do not fit side by side, as on a phone, the actions drop below it); `.empty-state` |
| `table`, `.table-wrap` | Tables as the platform draws them; `table.dense` for a dense one; `th.num`, `td.num` right-align figures; `tr.picked` or `tr[aria-selected=true]` for a selected row |
| `button`, `.button` | `.primary`, `.danger`, `.link`, `.small`, `.icon`; `form.inline` for a one-button form |
| `.badge` (or `.pill`) | Neutral, `.good`, `.warn`, `.bad`, `.accent`, `.info`, `.buy`, `.sell`; `.dot` inside for a status dot |
| `.notice` | `.info`, `.bad`, `.warn`, `.good`, `.quiet` (a `<details class="notice quiet">` folds) |
| `.tabs` with `.tab` | The current tab is `.on`, `[aria-current=page]` or `[aria-selected=true]`; `.count` inside |
| `.field` | A label: `<label class="field"><span>Name</span><input><span class="hint">…</span></label>`; `aria-invalid="true"` marks a bad value; `.filters` is a row of controls; `.grid-2`, `.grid-3`. A field's and a secondary button's edge is `--line-strong` (3:1). A `select` is as tall as a text input |
| `.field-row` | A field and its button on one row, level and the same height: `<div class="field-row"><label class="field"><span>Account</span><select>…</select></label><button>Link</button></div>`; more than one field may share it, and on a narrow row the button drops below. A hint goes under the row |
| `fieldset.choice`, `.options`, `label.option` | A choice drawn as the dashboard's settings draw one: `<fieldset class="choice"><legend>Key</legend><div class="options"><label class="option"><input type="radio" name="k" value="p"><span><span class="option-label">Personal</span><span class="hint">…</span></span></label>…</div></fieldset>`; the chosen option is marked. `label.check` is a checkbox and its words on a line |
| `.tiles` with `.panel.tile` | Figures: `.tile-label`, `.tile-value`, `.tile-delta` |
| `.menu`, `.menu-pop`, `dialog` | A `<details class="menu">` menu, and dialogs with `.dialog-head`, `.dialog-body`, `.dialog-foot` |
| `.chips`, `.chip` | Removable filters |
| Text | `.muted`, `.faint`, `.hint`, `.mono`, `.num`; `.bad-ink`, `.good-ink`, `.warn-ink`, `.buy-ink`, `.sell-ink`; `.row` and `.spacer`; `ul.plain`; `.visually-hidden` |

## Web components

Every component reaches the network only on the page's own origin (the
plugin's server, which proxies anything further): a URL on any other origin
is refused with an `om-error` event, never fetched. Figures are shown as the
strings the plugin sent and sorted exactly, never through floating point.

### Data without script

A page in any language gives a component its data as JSON in its HTML, and
writes no script: a `<script type="application/json">` directly inside the
element, read once when the element is first drawn. `om-grid` takes
`{ "columns": […], "rows": […] }` this way, `om-account-map` its data, and
`om-entry-grid` its columns, rows, the server's messages and its rules. The
JSON must not close the element early: write `<`, `>` and `&` in strings as
`\u003c`, `\u003e` and `\u0026`. What else the page puts inside (a plain
`<table>`, plain forms) is what a browser shows without the kit, and the
element replaces it. Data set by script wins over the declared JSON; JSON that
does not parse fires `om-error` and is read as none.

```html
<om-grid row-key="id" narrow="cards" caption="Accounts">
  <script type="application/json">{"columns": [{"key": "account", "label": "Account", "hint": "where", "strong": true}],
    "rows": [{"id": "st-1", "account": "Individual brokerage", "where": "Interactive Brokers · Margin"}]}</script>
  <div class="table-wrap"><table>…the same, for a browser without the kit…</table></div>
</om-grid>
```

### om-grid

A data grid for records that change: keyed rows replaced in place, updates
conflated to one paint per frame.

```html
<om-grid id="orders" row-key="order_id" sort="sent:desc" dense caption="Orders" empty="No orders."></om-grid>
```

| Attribute | |
|---|---|
| `row-key` | The field naming each row (default `id`). The `rowKey` property also takes a function of the row |
| `sort` | `key:asc` or `key:desc`; empty for arrival order |
| `dense` | The dense table |
| `sticky-head` | A scrolling body under a fixed head, `--om-grid-height` tall (default 28rem) |
| `caption`, `empty` | The table's caption (for a screen reader), and what an empty grid says |
| `high-rate` | [High-rate mode](#high-rate-mode), for streams: virtual scrolling, cell-level updates, a change flash |
| `freeze-sort` | Hold the order while rows change; removing it sorts again |
| `row-height` | High-rate mode's fixed row height in pixels (default 36, dense 28) |
| `no-flash` | High-rate mode without the change flash |
| `narrow` | Its [layout where it is narrow](#narrow-layouts): `cards` or `priority`. Without it a narrow grid scrolls sideways, as before |

| Property or method | |
|---|---|
| `columns` | `[{ key, label, type, align, sortable, group, tone, format, compare, width }]`. `type` is `text` (default), `decimal` or `number` (right-aligned, tabular, sorted exactly), `badge`, `code` or `date`. `group: true` groups a decimal's digits (`1,234.50`, nothing rounded). `tone: "sign"` colours a figure buy (up) or sell (down) by its sign, following the person's convention; for a badge, `tone(value, row)` returns `good`, `warn`, `bad`, `accent`, `info`, `buy` or `sell`. `format(value, row)` returns text or a node (for a badge, its text or what goes inside it); `compare(a, b)` overrides the sort. And, as plain JSON: `hint`, `tone: { field }`, `blank`, `strong` ([rich cells](#rich-cells)) and `priority` ([narrow layouts](#narrow-layouts)) |
| `setRows(rows)` / `rows` | Replace every row (a snapshot) |
| `upsert(row or rows)` | Insert or replace by key, on the next frame; the last state per key wins |
| `remove(key or keys)` | Remove by key, on the next frame |
| `flush()` | Apply queued updates now |
| `sortBy(key, "ascending" \| "descending")`, `sort` | Sort in script |
| `getRow(key)` | A row by key |
| `size` | How many rows it holds |
| `highRate`, `freezeSort` | The `high-rate` and `freeze-sort` attributes, as booleans |
| `scrollToRow(key, { focus })` | Bring a row into view (in high-rate mode, drawing it first), and the keyboard to it with `focus: true`. False for an unknown key |

| Event | `detail` |
|---|---|
| `om-sort` | `{ key, direction }`, when a header is clicked. Cancel it (`preventDefault`) to sort on the server and `setRows` the result |
| `om-row` | `{ key, row }`, when a row is clicked |

#### Rich cells

A cell says more than its value with no `format` and no script, each option
plain JSON:

| Column option | |
|---|---|
| `hint: "field"` | The row's `field`, shown under the value (`.hint`) |
| `tone: { "field": "f" }` | The tone named by the row's field `f`: a badge's (`good`, `warn`, `bad`, `accent`, `info`, `violet`, `buy`, `sell`), and on any other column the text in `good`, `warn`, `bad`, `buy` or `sell`'s colour. Anything else is no tone, never a class |
| `blank: "text"` | What an empty value says, faint |
| `strong: true` | The value in strong text, as a row's name |

In high-rate mode a cell redraws when its `hint` or `tone` field changes, as
if the column watched them.

#### Narrow layouts

Where a grid is under 40rem wide (a phone, or a narrow panel: it is the
grid's own width, by a container query), `narrow` chooses:

- **`cards`**: each row is a card. Its first column is the card's title; every
  other value sits under its column's name, and an empty cell goes. The head
  stays for a screen reader, out of sight. For records whose columns each
  matter, such as an account's sync state. Not in high-rate mode, whose rows
  keep one height.
- **`priority`**: the columns the page wants least hide first. A column's
  `priority` is `1` (or none: never hidden), `2` (hidden under 32rem) or `3`
  (hidden under 48rem). The table stays a table, so columns still compare down
  the rows; what is hidden is not on the page at that width. For figures
  scanned down a column, such as positions or quotes, and with high-rate mode.

Each cell carries its column's name (`data-label`) and priority
(`data-priority`) for these.

#### High-rate mode

For a stream: thousands of rows taking hundreds of changes a second, such as a
quote board or a blotter. The same element and the same API, with
`high-rate`:

```html
<om-grid id="quotes" row-key="symbol" high-rate dense sort="change:desc" caption="Quotes"
         style="--om-grid-height: 32rem"></om-grid>
<script type="module">
  const quotes = document.getElementById("quotes");
  quotes.columns = [
    { key: "symbol", label: "Symbol", type: "code" },
    { key: "last", label: "Last", type: "decimal", group: true },
    { key: "change", label: "Change", type: "decimal", tone: "sign" },
  ];
  // om-live feeds it the same way (for="quotes"); upsert as deliveries arrive.
</script>
```

- **Virtual scrolling.** Only the rows in view, and six either side, are in
  the document; the rest are space, so 10,000 rows are a few dozen elements.
  The row height is fixed (`row-height`, default 36 px, 28 dense), cells do
  not wrap (long text ends in an ellipsis), and column widths are fixed
  (`width` on a column, else equal) so they do not shift as rows scroll in.
  The view is `--om-grid-height` tall (default 28rem) with the head held;
  inside an [om-panels](#om-panels) panel it fills the panel.
- **Cell-level updates.** An update touches only the cells whose value
  changed, and only in rows in view; a row out of view costs no document
  work. A `format` or badge `tone` that reads other fields of the row names
  them in the column's `watch: ["field", …]`, so the cell redraws when they
  change too.
- **The change flash.** A changed cell flashes: a numeric column's rise in
  `--buy-wash` and fall in `--sell-wash`, compared exactly, so it follows the
  person's green-up or red-up convention; any other change in
  `--accent-wash`. None under `prefers-reduced-motion: reduce`, or with
  `no-flash`.
- **Conflated, and sorted exactly.** Updates still apply once per animation
  frame, the last state per key winning. The order is kept as it changes
  rather than re-sorted each frame: a row whose sorted value changed is taken
  out and put back by binary search, comparing decimals exactly, ties in
  arrival order. With `freeze-sort` the order holds while streaming (a changed
  row stays put, a new one goes last) so rows do not jump under the pointer; a
  header click still sorts, as the person asked, and removing `freeze-sort`
  sorts again.
- **Keyboard and screen reader.** The grid is one tab stop, a scrolling
  region named by `caption`. The arrow keys move from row to row, Page Up and
  Page Down by a view, Home and End to the first and last row (drawn as they
  are reached), and Enter or Space raises `om-row` for the row. The table
  carries `aria-rowcount` (every row, and the head) and each drawn row its
  `aria-rowindex`, so a screen reader says "row 5,002 of 10,001" of a row
  that is one of thirty in the document.

**The budget**, held by `make bench` in headless Chromium: 10,000 rows taking
1,000 updates a second for 5 seconds, half of them to rows in view and every
one moving the sorted column, each frame's main-thread time (the grid's frame,
style, layout and paint) under 16.7 ms at the 95th percentile, with every
update applied and the order exact; also while scrolling, and frozen.

### om-chart

Line and bar charts of time series, drawn as SVG in the scheme's colours.

```html
<om-chart id="nav" type="line" height="240" label="Net asset value"></om-chart>
<script type="module">
  document.getElementById("nav").series = [
    { name: "Growth", color: "accent", points: [["2026-09-01", "1204.50"], ["2026-09-02", "1210.25"]] },
  ];
</script>
```

`type` is `line` (default) or `bar` (grouped, from zero); `height` in pixels
(default 240); `label` names it to a screen reader; `legend` shows a legend
for one series (more than one always has one). A series has a `name`, a
`color` (`accent`, `violet`, `warn`, `buy`, `sell`, `good`, `danger`, `soft`;
by default the first six in turn) and `points`, each `[time, value]` or
`{ t, v }`. A time is `YYYY-MM-DD`, an ISO date-time or epoch milliseconds;
a value a number or a decimal string. Values are placed as numbers (a pixel
is not money) and the hover tooltip shows each exactly as given. It redraws
when its width changes.

### om-asof

The date a page's figures are as of: a date, a day back, a day on, and the
latest.

```html
<om-asof id="asof" name="as_of" value="2026-09-28" max="2026-09-28" label="As of"></om-asof>
```

`value` is `YYYY-MM-DD`, or empty for the latest; `min` and `max` bound it;
`disabled`. It is a form control (its value is submitted under `name`), and
fires `change` with `detail: { value }`. Day steps are calendar arithmetic on
the date, so no time zone moves them.

### om-moment

The moment a page's figures are as of, to read rather than to choose.

```html
<om-moment label="Last read" value="2026-09-29T12:04:00Z">Last read 2026-09-29 12:04 UTC</om-moment>
```

`value` is an ISO 8601 date-time with its offset (`Z` or `±hh:mm`), shown to
the minute in UTC (`2026-09-29 12:04 UTC`), or with `zone="local"` in the
reader's own time zone, named; or a date, `YYYY-MM-DD`, shown as it is. It is
drawn as a `<time>` whose `datetime` is the moment, so a screen reader and a
script read it exactly. An empty or unreadable value shows `empty` (default
"Not yet"), never a guess; a date-time without an offset is unreadable, since
the moment it names is not known. `label` goes before it. What the page puts
inside is shown until the kit draws it.

### om-status

How something the page reads is doing, as a small coloured dot: green when
the last update succeeded, amber while it is updating or when it needs
attention, red when it failed.
Hovering or focusing the dot, or tapping it, shows a note with what it is,
the detail (an error's message) and when it last updated.

```html
<om-status state="ok" label="SnapTrade read" at="2026-09-30T13:12:00Z" at-label="Last read">
  SnapTrade read. Last read 2026-09-30 13:12 UTC
</om-status>
<om-status state="error" label="The last read failed" detail="SnapTrade answered 503.">
  The last read failed. SnapTrade answered 503.
</om-status>
```

| Attribute | |
|---|---|
| `state` | `ok` (`--good`, a disc with a check), `busy` (`--warn-ink`, a turning ring, still under `prefers-reduced-motion`), `warn` (`--warn-ink`, a triangle with an exclamation: it needs attention) or `error` (`--danger`, a disc with an exclamation). Anything else is a neutral dot, never a guess |
| `label` | What the state means, the dot's accessible name (visually hidden) and the note's first line. Default "Up to date", "Updating", "Needs attention" or "Failed" |
| `detail` | A line under it: an error's message, say |
| `at` | The moment of the last update, as `om-moment`'s `value` and shown as it shows it, after `at-label` (default "Updated"); `zone="local"` as `om-moment`'s. Left out, or unreadable, no moment is shown |

Colour is never the only signal: each state has its own mark, and the label
is the dot's name. The dot is a button, so a keyboard reaches it; the detail
and the moment are its description (`aria-describedby`), so a screen reader
reads them with it. Pressing it holds the note open, pressing again or Escape
hides it until the pointer or focus leaves. Every word is set as text, never
as markup. What the page puts inside is shown, beside the dot the kit's CSS
draws from `state`, until the kit's script draws it: so without script the
label, detail and moment show as plain text. `state` is also a property.

**In the page's head.** Marked `data-om-header`, the head's status is the
plugin's own, which a framed page hands to the host to draw beside the
plugin's name, so no line is left under the host's tabs for it; unmarked, it
stays in the page, framed or not. See the header status under
[the frame: seamless](#the-frame-seamless).

### om-instrument-picker

Find an instrument by any identifier or its name, as of a date.

```html
<om-instrument-picker name="instrument_id" src="api/instruments/search" asof="asof" limit="10"></om-instrument-picker>
```

| Attribute | |
|---|---|
| `src` | The search URL, on the page's origin: the plugin's backend answers it and proxies the security master |
| `asof` | The id of an `om-asof` on the page, or a date: resolution is dated |
| `limit` (10), `min-chars` (1), `debounce` (200 ms), `placeholder`, `label`, `name` | |

It asks:

```
GET <src>?q=<text>&limit=<n>[&as_of=YYYY-MM-DD]
Accept: application/json
(the page's cookies, same origin)
```

and expects `200` with:

```json
{
  "results": [
    {
      "instrument_id": "INS-3f1c9a02",
      "description": "Apple Inc. common stock",
      "asset_class": "equity",
      "currency": "USD",
      "exchange_mic": "XNAS",
      "identifiers": [
        { "scheme": "ticker", "value": "AAPL", "source": "" },
        { "scheme": "isin", "value": "US0378331005", "source": "" }
      ]
    }
  ]
}
```

The fields are the security master's `InstrumentRecord` (meridian-core's
`reference.proto`, answering `SearchInstruments`) by their proto names; only
`instrument_id` is required, and a result without one is dropped. `q` is any
identifier value, of any scheme, or a name; `as_of` absent means now. Any
other status, or an answer without `results`, shows "Search failed" and fires
`om-error`.

It is a combobox (arrows, Enter, Escape) and a form control whose value is the
chosen `instrument_id`. Properties: `value`, `instrument` (the chosen record,
settable), `search(text)` (search now; resolves when drawn), `clear()`.
Events: `om-select` with `detail: { instrument }` (null when cleared), and
`om-error` with `detail: { error }`.

### om-live

Follows the plugin's server-sent events and never misses one. The channel is
meridian-design's `spec/plugins-hear-and-read.md` (Q4): server-sent events
from the plugin's own server to its page, each delivery carrying its sequence,
the page re-reading on reconnect.

```html
<om-live src="events" snapshot="positions.json" for="positions" events="position"></om-live>
```

| Attribute | |
|---|---|
| `src` | The event stream, on the page's origin |
| `snapshot` | The snapshot to read first, after a gap and after every reconnect |
| `for` | The id of an `om-grid` to feed (optional) |
| `events` | Named events to follow as well as unnamed ones (optional) |
| `quiet` | Hide its status badge |
| `manual` | Do not start on connect; call `start()` |

The wire:

```
GET <snapshot>        200 application/json
{ "sequence": "41", "rows": [ { ...a whole record... } ] }

GET <src>             200 text/event-stream
id: 42
data: { "rows": [ { ...the record's whole new state... } ], "removed": [ "a key" ] }
```

The sequence is the event's `id`, a decimal string compared exactly (as a
BigInt); `data.sequence` is read only when there is no id. A delivery at or
below the last one applied is a duplicate and dropped. One that skips a number
is a gap: it fires `om-gap`, reads the snapshot again, and applies what
arrived meanwhile past the snapshot's sequence. On every reconnect it reads
the snapshot too, rather than trusting what was sent while it was away; a
stream closed for good is reopened with backoff (1 s doubling to 30 s).
Deliveries that arrive while a snapshot is being read are held and applied
after it. `rows` and `removed` are the grid's convention (records carry their
whole new state, as the spec's Q2 rules); a page listening itself may carry
anything in `data`.

| Event | `detail` |
|---|---|
| `om-snapshot` | `{ sequence, data }`: a snapshot was read, first or after a gap or reconnect |
| `om-change` | `{ sequence, data, event }`: a delivery, in order, with no gaps |
| `om-gap` | `{ expected, received }`: a snapshot read follows |
| `om-state` | `{ state }`: `connecting`, `live`, `catching-up`, `reconnecting`, `offline`, `stopped` (also its `state` attribute) |
| `om-error` | `{ error }`: an unreadable delivery, a failed snapshot, another origin |

Properties and methods: `sequence` (the last applied, a string), `state`,
`start()`, `stop()` (also on leaving the page), `resync()`.

### om-panels

Resizable, rearrangeable panels inside a page, each holding whatever the page
puts in it, the arrangement remembered per person.

```html
<om-panels id="desk" layout-id="positions-page" style="--om-panels-height: 40rem">
  <section data-panel="positions" data-title="Positions" data-min="320">
    <om-grid id="positions" row-key="position_id" high-rate></om-grid>
  </section>
  <section data-panel="orders" data-title="Orders"><div class="panel-body">…</div></section>
  <section data-panel="chart" data-title="Net asset value"><div class="panel-body"><om-chart id="nav"></om-chart></div></section>
</om-panels>
```

Each child with a `data-panel` id is a panel, drawn as a card with a head (a
grip and its `data-title`); a `.panel-body` inside is padded, and a high-rate
grid placed directly in a panel fills it. By default the panels sit side by
side (`direction="row"`, or `column`) in equal shares.

A person **resizes** by dragging the gutter between two panels, or by focusing
it (a `separator`, with `aria-valuenow`) and using the arrow keys (16 px, 64
with Shift; Home and End to either side's minimum). A panel never goes below
its `data-min` (pixels, default 120). A person **rearranges** by dragging a
panel's grip onto another panel: onto an edge (the outer quarter) to dock
beside it there, onto the middle to swap; the landing place is shown, and
Escape cancels. From the keyboard, the grip's arrow keys swap the panel with
its nearest neighbour that way. Each move is announced to a screen reader.

The panels never move in the document: each is placed by style over one
positioned box, so a grid, a live feed or a frame inside keeps its state when
the arrangement changes. Tab order is the source order.

| Attribute | |
|---|---|
| `layout-id` | The page's name for this arrangement, under which it is remembered |
| `direction` | `row` (default) or `column`: the default arrangement's split |
| `--om-panels-height`, `--om-panels-gap` | Its height (default 36rem) and the space between panels (default 8px) |

| Property or method | |
|---|---|
| `layout` | The arrangement, serialisable (below). Setting it arranges the panels (a page restoring what it stored itself) and fires nothing |
| `defaultLayout` | The arrangement for a person with none stored, and what `reset()` returns to |
| `move(id, target, where)` | Move a panel: `"swap"`, or `"left"`, `"right"`, `"top"`, `"bottom"` of `target` |
| `reset()` | The default arrangement, forgetting the stored one |
| `panels` | The panels' ids, in source order |

| Event | `detail` |
|---|---|
| `om-layout` | `{ id, layout, reason }` after a person's change (`resize`, `move`) or `reset`. Cancel it (`preventDefault`) to keep the arrangement somewhere else rather than in the browser |

**The arrangement** is a tree of splits, each laying its children side by side
(`row`) or one above another (`column`) in shares summing to one:

```json
{ "version": 1, "root": { "split": "row", "sizes": [0.6, 0.4], "children": [
  { "panel": "positions" },
  { "split": "column", "sizes": [0.5, 0.5], "children": [{ "panel": "orders" }, { "panel": "chart" }] } ] } }
```

It is remembered in the browser, in `localStorage` under
`om-panels:<layout-id>` on the plugin's origin (with no `layout-id`, not at
all). Storage that is refused (a private window, a blocked site) changes
nothing but the remembering. An arrangement read back is fitted to the panels
the page has: a panel it does not know is dropped, and one it lacks is added
at the end, so a page can add a panel without breaking anyone's arrangement.
To keep it per person on the plugin's server instead, cancel `om-layout`,
store `detail.layout`, and set `layout` from it when the page loads.

### om-account-map

A plugin links each external account it reads (a brokerage account behind a
custody connector) to one of the deployment's accounts, on its admin page
(meridian-design W6.4). Built for an industrial deployment's hundreds or
thousands of accounts: a dense table, one row per external account, with its
name and detail, its link (the account it is linked to, or Not linked), and
its actions; since 0.6.0, where the plugin gives one, its status (its sync
state, say) and a few values beside it, so one page shows both. Each row
stacks under 40rem (by the map's own width).

```html
<om-account-map action="/admin/accounts/link" token-name="csrf" token="3f9c…"
                group-by="connection" link-several empty="No accounts yet.">
  <script type="application/json">{
    "external_accounts": [
      { "external_account_id": "st-19fe03aa", "name": "Roth IRA", "detail": "Fidelity · IRA",
        "custodian": "Fidelity", "account_type": "IRA", "note": "",
        "number": "Z12345678", "connection": "Fidelity · Individual", "connection_id": "c-2",
        "status": { "state": "warn", "label": "Stale", "detail": "Holdings are a day old.",
                    "at": "2026-09-29T09:30:00Z", "at_label": "Holdings as of" },
        "values": [{ "label": "Last statement", "value": "42 rows" }] }],
    "accounts": [
      { "account_id": "ACC-7b20c1e5", "name": "Main", "custodian": "Interactive Brokers", "account_type": "Margin", "open": true }],
    "links": [
      { "external_account_id": "st-7b20c1e5", "account_id": "ACC-7b20c1e5", "account_name": "Main" }]
  }</script>
  …what the page shows without the kit…
</om-account-map>
```

| Data | |
|---|---|
| `external_accounts` | The plugin's accounts: `external_account_id` (required), `name`, `detail` (a line under it, such as the brokerage and type), `custodian` and `account_type` (a new account's, prefilled), `note` (a hint); since 0.5.0, optionally `number` (the venue's account number, for matching and shown; leave out one the venue masks), `connection` and `connection_id` (the connection it is reached through, to group by); since 0.6.0, optionally `status` and `values` (below) |
| `accounts` | The deployment's accounts, read for the admin viewing the page (`read_accounts_for_linking`): `account_id`, `name`, `custodian`, `account_type`, `open` (default true), and since 0.5.0 an optional `number`. Only open ones are offered. `null` or missing says they could not be read |
| `links` | The plugin's links as the SDK gives them (`AccountScope.links`: `external_account_id`, `account_id`, `account_name`). An external account in it is linked, naming that account; one not in it is not linked. There is no third state |

| Attribute | |
|---|---|
| `action` | Where every form posts (default: the page's own address) |
| `token-name`, `token` | The page's token, sent in a hidden field of that name in every form (none when `token-name` is absent) |
| `empty` | What it says with no external accounts |
| `group-by` | `connection` or `custodian`: the grouping to start with (the person may change it) |
| `page-size` | Rows on a page, 50 by default |
| `link-several` | The handler at `action` takes several links in one form (below): "Link N suggested…" is offered |
| `no-new-account` | Since 0.7.1: the person viewing the page may not create an account, so no new account is offered anywhere (below) |
| `status-heading` | The Status column's heading (default "Status"), such as "Sync state" |

**Status, since 0.6.0.** An external account may carry `status`, `{ state,
label, detail, at, at_label }`: [om-status](#om-status)'s `state` (`ok`,
`busy`, `warn` or `error`), `label` (required unless the state's own name
will do), `detail`, `at` and `at-label`; and `values`, a few
`{ label, value, tone }` (`tone` `good`, `warn` or `bad`) shown under it,
such as the last statement. Where any account carries either, the table has
a Status column after the external account: the dot, its label beside it,
its detail and moment in its note, and the values under it. A status of
another shape is left out, never guessed.
**Finding one among thousands.** Above the table, a search, the filters and
the grouping; under it, the pages.

- *The search* matches every word typed, anywhere in the external account's
  name, ID, number, custodian, type, detail and connection, or in the name,
  ID, custodian, type or number of the account it is linked to or suggested
  for; case, spacing and character width aside. It is applied at most once a
  frame, however fast the typing.
- *Unlinked, Linked and All*, each with its count under the search. The map
  opens on Unlinked when any account is unlinked, because that is the work,
  and on All otherwise.
- *State*, where any account carries a status: All states, Needs attention
  (`warn` or `error`), then each status by its label, what needs acting on
  first (`error`, `warn`, `busy`, `ok`), each with how many of what the
  search finds are in it. The link filter's counts are within the state
  chosen, and the search reads each status's label and detail and each value.
- *Group by* connection or custodian (offered only where the data has at
  least two), each group's head saying how many it holds (and, under All,
  how many are not linked), folded and unfolded by its head.
- *Pages* of `page-size` rows, so the document holds a page of rows however
  many accounts there are; a row once drawn is kept and moved, not drawn
  again. Data set again keeps the search, the filter, the grouping and the
  page as far as it can.

**One row's choices.** A row offers Link… (Change… when linked); its choices
open under that row alone, one row at a time, and close on Close, Escape or
pressing it again: an existing open account, found by typing into a chooser
(the first 50 matches listed, the suggestion first; a closed account, and
the one it is linked to, never), a new account named from the external one,
and on a linked account, Unlink.

**No new account, since 0.7.1.** Only a deployment admin may create an
account (W6.4): a plugin admin who is not one links each external account to
an existing account and names no new one. A page viewed by such an admin says
`no-new-account`, and the map offers no new account anywhere: a row's
choices are the chooser alone (and Unlink, on a linked account), with no
"or" and no Create and link; where there is no open account to choose, it
says so without "create one"; suggestions and the several-link review are as
they were, since they only ever link to an existing account. No `create`
form is drawn, so none is sent. What the page shows without the kit should
match: no form to create an account for that viewer. The attribute hides the
option; the page's handler still refuses `create` from a viewer who may not
create one. Without it, the map offers a new account as before.

**Suggestions.** Where an unlinked external account's name, or its number,
matches exactly one open account (a name to a name; a number to a number, or
to a name), that account is suggested in its row, with why ("same name",
"same number", "named by its number"). Matching is exact but for case,
spacing and character width. None is suggested where two accounts match,
where the account is linked to another external account already, where two
unlinked accounts would claim the one account, or where the deployment's
accounts could not be read. The row's Link takes it, as the plain `link`
form; opened, its chooser starts on it.

With `link-several`, "Link N suggested…" (the suggestions the search finds)
opens a review: each pair, external account to account, with a checkbox to
leave it out, and "Link N accounts" sends them together.

**The forms.** Each is a plain `<form method="post">`, so a page needs no
script. Its fields are named as the SDK's `link_external_account` takes them,
beside the token and `intent`:

| `intent` | Fields | Shown |
|---|---|---|
| `link` | `external_account_id`, `account_id` | An account chosen from the chooser, and Link; or a suggestion's Link |
| `create` | `external_account_id`, `new_account_name` (required, the external account's name to start), `new_account_custodian`, `new_account_type` (prefilled, may be emptied) | Create and link, unless `no-new-account` |
| `unlink` | `external_account_id` | Unlink, on a linked account |
| `link-several` | `external_account_id` and `account_id`, repeated: one pair per link, in order | The review's "Link N accounts", with `link-several` only |

The server does what `intent` says, as
`link_external_account(external_account_id=…, account_id=…)`,
`link_external_account(external_account_id=…, new_account_name=…,
new_account_custodian=…, new_account_type=…)` or
`link_external_account(external_account_id=…)`, acting for the admin, then
answers with the page again.

**What a handler of `link-several` must accept.** A form whose `intent` is
`link-several` carries the token once and, after it, `external_account_id`
and `account_id` repeated, in the order the page wrote them: the first
`external_account_id` is linked to the first `account_id`, and so on (read
them as lists, as `parse_qs`, `request.form.getlist` or
`URLSearchParams.getAll` give them). Refuse the whole form if the two lists
differ in length or one external account appears twice; otherwise check the
token once, then link each pair as its own `link_external_account` call (a
link is per external account; one failing does not undo the others), and
answer with the page, saying how each went. The body grows about a hundred
bytes a pair, so allow for a few thousand pairs. A handler that does not
know the intent answers it as any unknown intent (the kit offers it only with
`link-several`, so a page that has not said so never sends it). The one-pair
`link` form stays, for a handler without it and for a suggestion taken alone.

| Property or method | |
|---|---|
| `data` | `{ external_accounts, accounts, links }`, as the JSON carries it; setting it redraws |
| `linkOf(external_account_id)` | The link standing for it, or null |
| `suggestionOf(external_account_id)` | `{ account_id, name, why }` suggested for it, or null |
| `suggestions` | Every suggestion, `{ external_account_id, account_id, why }`, in the order of the external accounts |
| `flush()` | Apply a search typed but not yet drawn now, rather than on the next frame |

| Event | `detail` |
|---|---|
| `om-link` | `{ intent, external_account_id, account_id, new_account_name, new_account_custodian, new_account_type, form }`, as a form is sent, and for `link-several` `pairs: [{ external_account_id, account_id }]` (its `external_account_id` and `account_id` then empty). Cancel it (`preventDefault`) to send the link yourself; the token is the form's. A `link` without a chosen account is not sent, and not heard |

**How fast.** `make bench` holds it, in headless Chromium, with 2,000
external accounts and 1,500 of the deployment's declared as JSON: typing a
search (a key a frame, and four), a page a frame, the filters, grouping and
folding, and typing in a row's chooser, each at a frame time under 16.7 ms at
the 95th percentile, at most one draw a frame, and at most a page of rows in
the document. Twenty thousand and fifteen thousand are measured for the
record. The gallery's [many-accounts page](src/gallery/accounts-many.html)
shows 2,000 and 1,500.

### om-entry-grid

Rows a person types, since 0.9.0: a table with a typed input per cell, rows
added as needed, posted as part of the page's own `<form>`. It is how a page
takes tabular data (an opening balance's lots, an instrument's identifiers):
the product owner ruled on 2026-10-03 that data entry defaults to a table
with typed column inputs, with a CSV a secondary way in, because a CSV says no
schema and cannot point at the one bad cell. It is its own element rather
than a mode of `om-grid`, which is built to show records that change (keyed
rows replaced in place, sorted, conflated per frame, virtual in high-rate
mode); a row being typed must neither move nor be redrawn under the person.

```html
<form method="post" action="/opening/lots">
  <input type="hidden" name="csrf" value="…">
  <om-entry-grid name="lots" caption="Lots" min-rows="1" csv>
    <script type="application/json">{
      "columns": [
        { "key": "quantity", "label": "Quantity", "type": "decimal", "required": true },
        { "key": "cost", "label": "Cost", "type": "decimal", "places": 2, "min": "0", "path": "terms.cost", "hint": "The lot's, in all" },
        { "key": "currency", "label": "Currency", "type": "code", "length": 3, "default": "USD" },
        { "key": "acquired", "label": "Acquired", "type": "date", "max": "2026-09-30" },
        { "key": "method", "label": "Method", "type": "choice", "options": [{ "value": "fifo", "label": "First in, first out" }, "specific"] },
        { "key": "lot_id", "label": "Lot", "type": "readonly" }],
      "rows": [{ "quantity": "10", "cost": "1500.00", "currency": "USD", "acquired": "2026-01-02", "lot_id": "L-1" }],
      "errors": [{ "path": "lots[0].terms.cost", "message": "A cost is the lot's in all, not a price." }],
      "rules": [{ "sum": "quantity", "equals": "15", "message": "Lots add up to {sum}; the position is {equals}." }]
    }</script>
    …the same rows as a plain table of inputs, for a browser without the kit…
  </om-entry-grid>
  <button class="primary">Save</button>
</form>
```

| Attribute | |
|---|---|
| `name` | Where the rows sit, a path in the data dictionary's grammar (`lots`, `positions[0].lots`; default `rows`): every input is named under it |
| `caption` | The table's caption, for a screen reader; also how its messages name it |
| `min-rows`, `max-rows` | The fewest rows posted (default 0) and the most shown (default 1,000). The grid shows at least `min-rows` rows, blank ones to fill, and a grid given no rows starts with one blank row; Remove is offered above `min-rows`, Add a row below `max-rows` |
| `csv` | Offer "Import a CSV" (below), a link under the table |
| `add-label`, `csv-label`, `empty` | The words of Add a row, of the CSV link, and of a grid with no rows ("No rows yet.") |
| `narrow` | `none` keeps the table where it is narrow, scrolling sideways; otherwise each row is a card under 40rem |

**The columns** are declared as `om-grid`'s are, `key`, `label` and `type`,
each with only the options it sets, all plain JSON:

| `type` | Takes | Options |
|---|---|---|
| `text` (default) | Any text | `max_length` (characters) |
| `decimal` | A decimal, exactly, as a string: `-12`, `1500.25`; never a float, and never a grouping comma ("Write it without grouping commas, like 1234.5") | `places` (the most decimal places, trailing zeros aside; `0` for a whole number), `min`, `max` (decimal strings, compared exactly) |
| `date` | A day in the calendar, `YYYY-MM-DD` (a text input, so a pasted or imported bad date stays to be fixed rather than vanishing from a date picker) | `min`, `max` |
| `code` | A currency's or an asset's code: letters, digits, `.`, `_` and `-`, posted in capitals | `length` (exactly), `max_length` (default 32) |
| `choice` | One of its options, a `<select>`; a value given that it does not offer is kept, marked "(not a choice)", until one is chosen | `options`: strings, or `{ value, label }`; `placeholder` (default "Choose…") |
| `readonly` | Nothing typed: shown as text and posted as it was given (a lot's ID, say) | |

And on any column: `required` (in a row that is not blank), `hint` (the
column's words for what to type, under its heading and describing each of its
inputs; not `om-grid`'s `hint`, which names a field), `path` (where the column
sits under a row, in the dictionary's grammar, such as `terms.cost`; default
the `key`), `default` (a new row's value), `placeholder` and `width`. A column
the grid cannot use (an unknown type, a key that is not a field's name, a bound
that is not a decimal) is refused with `om-error`, never guessed: the page's
own table then stays, and posts as it is.

**Posting.** Each cell is a real input in the page's form, named by its
path: `name[n].path`, `lots[0].quantity`, `lots[0].terms.cost`. So the form
posts with its own token and its own submit, and the server reads the same
names a refusal will name. A row with nothing typed in it (every cell its
column's default, and no read-only value) is blank: it is not checked and not
posted, and the rows posted are numbered from 0 without a gap, so `n` is a
row's index as posted. A server reads the rows as lists, for example in Python:

```python
rows = {}
for name, value in form.multi_items():
    m = re.fullmatch(r"lots\[(\d+)\]\.(.+)", name)
    if m:
        rows.setdefault(int(m[1]), {})[m[2]] = value.strip()
lots = [rows[i] for i in sorted(rows)]
```

and treats a row whose every value is empty as no row, since the page's own
table (below) posts its blank rows. CSRF stays the page's form's job: the grid
adds no field of its own and reads none.

**Checked as typed.** Each cell is checked against its column as it is typed
(lib/entry.js holds the words, for a server to share): its type and bounds at
once, and `required` once its row is left (or the cell emptied). The message
is under the input, which is `aria-invalid` and described by it, and is said
once by a polite live region. A cell with a problem holds the form's submit as
any invalid input does (`setCustomValidity`); a held submit shows every
problem in the grid and takes the keyboard to the first, with no browser
bubble over a message already on the cell. A button with `formnovalidate` (a
draft's "Check") still posts what is there. A committed value is shown as it
posts: trimmed, a code in capitals.

**The server's word, by path.** The server answers with the page again,
its messages in the grid's JSON as `errors`, or a page with script calls
`setErrors(errors)`. Each is `{ path, message }`, the path in the data
dictionary's grammar (meridian-design
`spec/every-store-publishes-a-versioned-data-dictionary.md`, "Paths"), as a
refusal's `fields` name them:

| Path | Shown |
|---|---|
| `lots[2].terms.cost` | On the cell: row 2 as posted, the column whose `path` is `terms.cost` (or, for `terms.cost.units`, the column it goes on beneath) |
| `lots[2]`, or a field no column has | Under the row, describing each of its cells |
| `lots`, or no path | Over the table, with the grid's own (`role="alert"`) |
| `lots[9].quantity`, past the rows | Over the table: "Row 10: …" |
| `positions[0].pending`, not under `name` | Over the table when declared (the page put it here); handed back by `setErrors` for the page to show elsewhere |

A message from the server is shown until its cell is changed (its row's,
until any of the row's cells; the table's, until any cell), since the server
will check again; it does not hold the submit. A refusal naming several
fields with one reason is one item per path.

**Rules over the rows.** A sum declared in the JSON, `{ "sum": "<a decimal
column>", "equals": "<a decimal>", "message": "…{sum}…{equals}…" }`, is
checked exactly as the rows change (the words default to "Quantity adds up to
{sum}; it should be {equals}."); a page's script adds any rule with
`addRule(rule)`, a function of the rows returning nothing, a message, `{ path,
message }` or a list of them (a path the grid's own or under it, `[1].cost`).
A rule's message on a cell or a row is shown at once; over the table, once a
value is committed (so its words do not change under every key). Each holds
the submit (the table's through the element itself, a form-associated custom
element, where the browser has `ElementInternals`).

**Paste from a spreadsheet.** Cells copied from a spreadsheet (tab-separated
lines, a quoted cell holding a line break as spreadsheets write it) and pasted
into a cell fill across and down from it, skipping read-only columns and
adding rows as needed up to `max-rows`, each cell checked and each pasted
row's required cells asked for. What is past the last column or past
`max-rows` is left out, and the grid says so under the table and to a screen
reader: "Pasted 12 rows. 3 cells to fix." One value pasted is the browser's
own paste.

**Import a CSV.** With `csv`, a link under the table opens a dialog (placed
where the link is, since a framed page's viewport is the whole page): the
columns the table takes, each with what it takes in words, so the schema is
said; a file to upload, or the CSV pasted (a comma, semicolon or tab, found
from its header line; at most 2 MB, read in the browser and sent nowhere).
Its headers are matched to the columns by key, label or path, case, spacing
and punctuation aside; where one does not match, the mapping is open to
choose each column's header by hand (a column not in the CSV takes its
default). Every row is previewed with each cell's problem ("3 cells to fix,
in rows 2 and 9"), and nothing in the table changes until Apply, which
replaces the table's rows or adds them after (asked only when it has some).
Applied, each problem is on its cell, to fix there. Nothing in the dialog is
posted with the page's form.

**The keyboard and a screen reader.** It is a real table: a caption, a
column header (`th scope="col"`) per column with its hint, a row header with
the row's number, and each input labelled "Quantity, row 3". Tab moves
through the cells in order; the arrow keys move between rows from a text
input, and left and right at the edge of its text (a choice keeps its own
arrows); Enter moves down a row and, on the last row, adds a row at the end
(Shift+Enter up), and never submits the form from inside the grid. Every
control is at least 44px tall, a touch target. A row added or removed, a
paste, a held submit and a cell's new message are said by a polite live
region; the table's messages are an alert.

**At a phone's width** (the grid's own width under 40rem), each row is a
card: "Row 3" with its Remove at the corner, then each input under its
column's name, its hint under it. In light, dark or any scheme, the grid uses
the scheme's properties only: a message in `--danger`, on the card.

**Where the kit is not served.** The page puts inside the element a plain
table of the same inputs, named the same way, each with its `aria-label`, and
a blank row or two for more (see [the pattern](#entry-grid)). Without the
kit's script that table is the form, and it posts; with it, the grid replaces
it, keeping anything typed into it before the kit arrived. A page that wants
more rows than it offers without script answers a submit button of its own
("Add a row", `name="do" value="add-row"`) by drawing the page again with one
more.

**How fast.** `make bench` holds it in headless Chromium, typing a key a
frame into a grid's first row (the worst place), a sum and a page's rule run
on every key: a number typed into 1,000 rows, and a cell's message coming and
going every other key in 100, each frame's main-thread time under 16.7 ms at
the 95th percentile; the grid's own script is under a millisecond a key at
1,000 rows. A message coming or going changes its row's height, and the
browser lays out every row under it again, in a table or any other layout, so
that frame costs in proportion to the rows below: at 1,000 rows, measured for
the record, about 80 ms in the bench's container. A page whose people
enter thousands of rows at once is better split into parts.

| Property or method | |
|---|---|
| `rows` | The rows as they would post (each not blank, its values as posted, keyed by column). Setting it replaces every row, and is what the form's reset returns to |
| `columns` | The columns; setting them redraws, keeping each row's values by key |
| `addRow(values)`, `removeRow(index)` | Add a row at the end (its index, or -1 at `max-rows`); remove one (false at `min-rows`) |
| `setErrors(errors)`, `clearErrors()` | The server's messages, by path (above); returns those not inside the grid |
| `addRule(rule)` | A rule over the rows (above); returns a function removing it |
| `checkValidity()`, `reportValidity()` | Whether every row is as its columns and rules want; the second shows every problem and takes the keyboard to the first |
| `openImport()` | Open the CSV dialog |
| `name`, `minRows`, `maxRows`, `size` | The attributes, and how many rows are shown |

| Event | `detail` |
|---|---|
| `om-change` | `{ rows }`, the rows as they would post, after a person's change: a cell typed in, a row added or removed, a paste, a CSV applied |
| `om-error` | `{ error }`: a column, a rule or the JSON the grid cannot use, or a page's rule that threw |

## Patterns

The markup every plugin's page writes for the same few things: the head with
its status and a header action, a status, a one-button form, a notice, a
badge, tiles, a moment, a grid, an entry grid, the page for somebody who may
read nothing here, and an empty state. Each is plain kit HTML, the same from any language.
An SDK's helpers that write them write exactly this, and a page written by
hand is as good. The Python SDK's `meridian/kit.html`, coming in
open-meridian 0.14.0 (meridian-design's
`spec/plugins-share-one-framework-in-code.md`), has a macro for each pattern
below, named beside it: `status`, `action`, `notice`, `badge`, `tiles`,
`when`, `grid`, `nothing_here` and `empty`, each held by its tests to its
pattern here.

A pattern is its elements, their attributes and their text. Whitespace
between tags, the order of attributes and the layout of a JSON value are not
part of it, so a test compares them parsed. Every value is escaped as HTML;
`…` stands for the page's token. An attribute shown only sometimes is left
out when it has nothing to say, never written empty. The
[patterns page](src/gallery/patterns.html) in the gallery is these blocks as
they are drawn, light and dark, on its own and framed; `make test` holds each
block here to its copy there.

### The head

What `meridian/base.html` writes, and what a page in any language writes: the
heading, the plugin's status (`data-om-header`, so a framed page hands it to
the host), and the header actions in `.actions`, only when there is one; then
the tab row. Framed, the kit hands the status and the actions up, the host
draws the heading and the tabs, and the head, left with nothing, goes.

```html
<header class="page-head">
  <div><h1>Statements</h1></div>
  <om-status data-om-header state="ok" label="SnapTrade read" at="2026-10-02T13:12:00+00:00" at-label="Last read">SnapTrade read. Last read 2026-10-02 13:12 UTC.</om-status>
  <div class="actions"><form method="post" action="/read" class="inline"><input type="hidden" name="csrf" value="…"><button data-om-action="refresh" data-om-icon="refresh" title="Refresh">Refresh</button></form></div>
</header>
<nav class="tabs">
  <a class="tab on" href="#statements" aria-current="page">Statements</a>
  <a class="tab" href="#raw">Raw responses</a>
</nav>
```

A page's notices come first in its content, under the tab row, in the order
they are said.

### Status

The plugin's status as [om-status](#om-status) draws it (`status`), marked
for the head:

```html
<om-status data-om-header state="busy" label="Reading SnapTrade" at="2026-10-02T13:12:00+00:00" at-label="Last read">Reading SnapTrade. Last read 2026-10-02 13:12 UTC.</om-status>
<om-status data-om-header state="warn" label="2 accounts await an opening balance">2 accounts await an opening balance.</om-status>
<om-status data-om-header state="error" label="The last read failed" detail="SnapTrade answered 503.">The last read failed. SnapTrade answered 503.</om-status>
```

- `state` is `ok`, `busy`, `warn` or `error`; `label` is always given.
- `detail` only when there is one: an error's message, say.
- `at` only with a moment, ISO 8601 with its offset, and `at-label` with it:
  the plugin's own words, "Last read" or "Last reconciled".
- Inside, what shows without the kit's script: the label, the detail, and the
  `at-label` with the moment as [a moment](#a-moment) shows it, each ending as
  a sentence (a full stop added where it has none), joined by a space.

### Action

A one-button form posting to the page's own server with the page's token
(`action`): the token first, then the form's own fields, in order, then the
button with its words.

```html
<form method="post" action="/accounts/link" class="inline"><input type="hidden" name="csrf" value="…"><input type="hidden" name="account" value="ALPACA:SYN-ALP-1001"><button class="primary">Link</button></form>
<form method="post" action="/connections/remove" class="inline"><input type="hidden" name="csrf" value="…"><input type="hidden" name="connection" value="c-1"><button class="danger">Remove</button></form>
<form method="post" action="/read" class="inline"><input type="hidden" name="csrf" value="…"><button aria-label="Refresh everything from SnapTrade">Refresh</button></form>
```

- `class` on the button only for `primary` or `danger`.
- `aria-label` only where the words alone do not say what it does.
- A header action is the same form in the head's `.actions` with
  `data-om-action="<id>"` on its button (see [the head](#the-head) and the
  header actions under [the frame: seamless](#the-frame-seamless)). An
  action's id is its plugin's own.
- An icon action adds `data-om-icon="<name>"`, a name the kit knows
  (`refresh`), and `title` with the button's accessible name (its
  `aria-label`, or else its words); its words stay inside.
- The token's field is the SDK's (`csrf` is the Python SDK's); the kit never
  reads it.

### Notice

What an action came to, or how the page's reading stands (`notice`):

```html
<div class="notice info" role="status">Reading SnapTrade now. Reload in a moment.</div>
<div class="notice good" role="status">Linked Individual brokerage to Main.</div>
<div class="notice warn" role="status">Linked 1 of 2 accounts. Not linked:<ul class="plain"><li>Roth IRA: already linked to Retirement.</li></ul></div>
<div class="notice bad" role="alert">The last read failed: SnapTrade answered 503.</div>
```

- The tone is `info` (the default), `good`, `warn` or `bad`.
- `role` is `alert` for `bad`, `status` for every other.
- Its items, when it has them, follow its text as a `ul.plain`.

### Badge

A short state (`badge`):

```html
<span class="badge good">Linked</span>
<span class="badge warn">Stale</span>
<span class="badge bad">Failed</span>
<span class="badge">Not linked</span>
```

The tone is `good`, `warn`, `bad`, `accent`, `info`, `buy` or `sell`, or none,
a neutral badge: then `class` is `badge` alone.

### Tiles

Figures at the head of the content (`tiles`):

```html
<div class="tiles">
  <div class="panel tile"><div class="tile-label">Accounts</div><div class="tile-value">3</div><div class="tile-delta good-ink">all linked</div></div>
  <div class="panel tile"><div class="tile-label">Last read</div><div class="tile-value">13:12</div><div class="tile-delta">2026-10-02</div></div>
  <div class="panel tile"><div class="tile-label">Holdings</div><div class="tile-value">42</div></div>
</div>
```

A tile's delta only when it has one, and its ink (`good-ink`, `warn-ink`,
`bad-ink`, `buy-ink` or `sell-ink`) only when it is given.

### A moment

A moment to read, in a sentence or a cell (`when`):

```html
<time datetime="2026-10-02T13:12:00+00:00">2026-10-02 13:12 UTC</time>
<time datetime="2026-10-02">2026-10-02</time>
<span class="faint">not reported</span>
```

A `<time>` whose `datetime` is the moment, ISO 8601 with its offset, shown as
[om-moment](#om-moment) shows it: in UTC to the minute, or a date as it is.
No moment is the faint words the page gives ("not reported" when it gives
none), never a guess. `om-moment` is for a moment in the reader's own zone.

### Grid

Records in an [om-grid](#om-grid) (`grid`): its columns and rows declared
inside it as JSON ([data without script](#data-without-script)), and the same
table beside them for a browser without the kit.

```html
<om-grid id="holdings" row-key="key" narrow="cards" caption="Holdings" empty="No holdings.">
  <script type="application/json">{"columns": [{"key": "instrument", "label": "Instrument", "type": "code", "hint": "identifiers"}, {"key": "quantity", "label": "Quantity", "type": "decimal", "group": true}, {"key": "state", "label": "State", "type": "badge", "tone": {"field": "tone"}}], "rows": [{"key": "AAPL", "instrument": "AAPL", "identifiers": "US0378331005", "quantity": "1250.5", "state": "Current", "tone": "good"}, {"key": "USD", "instrument": "USD", "identifiers": "", "quantity": "18004.12", "state": "Assumed", "tone": "warn"}]}</script>
  <div class="table-wrap"><table><thead><tr><th>Instrument</th><th class="num">Quantity</th><th>State</th></tr></thead><tbody>
    <tr><td><code>AAPL</code> <span class="hint">US0378331005</span></td><td class="num">1250.5</td><td><span class="badge good">Current</span></td></tr>
    <tr><td><code>USD</code></td><td class="num">18004.12</td><td><span class="badge warn">Assumed</span></td></tr>
  </tbody></table></div>
</om-grid>
```

- `id` and `row-key` always; `narrow` is `cards` unless the page asks for
  `priority` or none; `caption` and `empty` only when given.
- The JSON is the columns, each with only the options it sets, and the rows,
  each with every field a column or its `hint` or `tone` names, with `<`,
  `>` and `&` in its strings written `<`, `>` and `&`.
- The table has a `th` for each column, then a row for each row, a `td` for
  each column: a `decimal` or `number` column's `th` and `td` are `num`, its
  value as the plugin sent it (the kit groups its digits); a `code` value is
  in `<code>`; a `badge` value is the [badge](#badge) of the row's tone; a
  `strong` value is in `<strong>`; the `hint` field, when the row has it,
  follows the value as a `span.hint`, after a space; an empty value is the
  column's `blank` words, faint (`<span class="faint">…</span>`), or
  nothing.
- With no rows, the table's body is one row of one cell across every column,
  saying `empty`: `<tr><td colspan="3">No holdings.</td></tr>`.

### Entry grid

Rows a person types, in an [om-entry-grid](#om-entry-grid) inside the page's
form: its columns, rows, the server's messages and its rules declared as JSON,
and the same rows as a plain table of inputs beside them, which is the form
where the kit is not served. The entry grid (0.9.0) has no SDK macro yet.

```html
<form method="post" action="/opening/lots">
  <input type="hidden" name="csrf" value="…">
  <om-entry-grid name="lots" caption="Lots" min-rows="1" csv>
    <script type="application/json">{"columns": [{"key": "quantity", "label": "Quantity", "type": "decimal", "required": true}, {"key": "cost", "label": "Cost", "type": "decimal", "places": 2, "path": "terms.cost", "hint": "The lot's, in all"}, {"key": "acquired", "label": "Acquired", "type": "date"}], "rows": [{"quantity": "10", "cost": "1500.00", "acquired": "2026-01-02"}, {"quantity": "4", "cost": "610.25", "acquired": "2026-10-04"}], "errors": [{"path": "lots[1].acquired", "message": "Acquired after the opening day, 2026-09-30."}], "rules": [{"sum": "quantity", "equals": "15", "message": "Lots add up to {sum}; the position is {equals}."}]}</script>
    <div class="table-wrap"><table><caption>Lots</caption><thead><tr><th class="num">Quantity</th><th class="num">Cost <span class="hint">The lot's, in all</span></th><th>Acquired</th></tr></thead><tbody>
      <tr><td class="num"><input name="lots[0].quantity" value="10" aria-label="Quantity, row 1"></td><td class="num"><input name="lots[0].terms.cost" value="1500.00" aria-label="Cost, row 1"></td><td><input name="lots[0].acquired" value="2026-01-02" aria-label="Acquired, row 1"></td></tr>
      <tr><td class="num"><input name="lots[1].quantity" value="4" aria-label="Quantity, row 2"></td><td class="num"><input name="lots[1].terms.cost" value="610.25" aria-label="Cost, row 2"></td><td><input name="lots[1].acquired" value="2026-10-04" aria-label="Acquired, row 2" aria-invalid="true" aria-describedby="lots-1-acquired"><span class="hint bad-ink" id="lots-1-acquired">Acquired after the opening day, 2026-09-30.</span></td></tr>
      <tr><td class="num"><input name="lots[2].quantity" aria-label="Quantity, row 3"></td><td class="num"><input name="lots[2].terms.cost" aria-label="Cost, row 3"></td><td><input name="lots[2].acquired" aria-label="Acquired, row 3"></td></tr>
    </tbody></table></div>
  </om-entry-grid>
  <button class="primary">Save</button>
</form>
```

- `name` always: the path the rows sit at; `caption`, `min-rows`,
  `max-rows` and `csv` only when given.
- The JSON is the columns, each with only the options it sets; the rows,
  each with a value for each column it has one for; `errors`, the server's
  messages by path, only when it has some; `rules` only when there are some.
- The table has a `caption`, a `th` per column (a `decimal`'s `num`) with its
  `hint`, when it has one, as a `span.hint` after a space; then a row per row
  given, a `td` per column holding an `input` named `name[n].path`, its value
  the row's (a `choice`, a `select` of its options; a `readonly` value as text
  and a hidden input), each with its `aria-label`, "Label, row n"; a cell the
  server named carries `aria-invalid="true"` and `aria-describedby` naming
  its message, a `span.hint.bad-ink` after the input; then one blank row, or
  more, for another row. A message on a row or the table goes over the
  table, as a [notice](#notice) `bad`.
- The page's own submit button follows the grid; its token is the form's.

### Nothing here

The page for somebody who may read none of the accounts the plugin reaches
(`nothing_here`): its whole content, with no notice, tile or action. The
first sentence is the plugin's, saying what it does; the second is every
plugin's.

```html
<section class="panel padded narrow">
  <h2>Nothing here for you</h2>
  <p>This plugin brings brokerage accounts into this deployment through SnapTrade, and you may read none of them. If you should, ask whoever administers this deployment.</p>
</section>
```

### Empty

A list or a section with nothing in it yet (`empty`): its title, and, when
there is one, a line saying what will fill it; inside the panel it is in, or
in a `.panel` of its own when it is the page's whole content.

```html
<div class="empty-state"><strong>No statements yet</strong><p>None of the accounts you may read has come through SnapTrade here yet. An account appears once it is linked to yours.</p></div>
```

## The theme: the frame's message

The dashboard frames a plugin's page and hands it the person's colour scheme,
mode and market-direction convention; `meridian.js` applies them, and the
plugin writes no code for it.

**On first load**, as query parameters on the framed page's URL:

```
?om-scheme=<id>&om-mode=<light|dark|system>&om-direction=<green-up|red-up>&om-framed=1
```

**On change**, as a message from the dashboard's frame to the page's window,
with `postMessage(message, pluginOrigin)`:

```json
{ "type": "meridian:theme", "version": 3, "scheme": "harbour", "mode": "dark", "direction": "red-up", "framed": true }
```

`scheme` is an id (lower-case letters, digits and hyphens, at most 64),
`mode` is `light`, `dark` or `system`, `direction` is `green-up` or
`red-up`, and `framed` is `true` or `false` (see
[the frame: seamless](#the-frame-seamless)); any may be left out to keep the
current one, and an invalid value is ignored rather than guessed. Version 2
added `direction` and version 3 `framed`; an earlier version's message is
still taken and keeps what it does not name, and a kit that knows an earlier
version follows what it knows and ignores the rest. The
dashboard is the only sender: the page accepts the message only when
`event.source` is its own `window.parent`, and never when it is not framed.
The dashboard should also send the message on each `load` of the frame, so a
navigation inside the frame follows the person's theme; the kit keeps the last
theme for the tab (`sessionStorage`) as well, so that navigation does not
flash.

Applying a theme sets `data-om-mode`, `data-om-scheme` and
`data-om-direction` on `<html>`, links `schemes/<id>.css` from the kit's own
base path (never another), and fires `om-theme` on `window` with
`detail: { scheme, mode, resolved, direction }` (`resolved` is `light` or
`dark`, following the system under `system`). The brand default is always
underneath: a scheme that fails to load is dropped and the page is the
brand's. `window.Meridian.theme.apply(scheme, mode, direction)` and
`window.Meridian.theme.current()` are there for a page that must know, such as
one drawing on a canvas.

**Market direction.** Which colour means up is a convention: green-up, or
red-up as markets in China, Japan, Korea and Taiwan draw it. The deployment
sets a default and each person may override it; the frame hands over the
result. A buy and a rise share a colour under either convention, so `--buy`
and `--sell` (and their washes) are the direction colours: use `--buy` for a
gain or an up move and `--sell` for a loss or a down move, and the kit swaps
them under red-up. The status colours (`--good`, `--danger`, `--warn-ink`)
never flip. There is nothing for a page to do.

## The frame: seamless

The dashboard's admin view of a plugin frames each of the plugin's admin pages
in a tab. The frame stays, because it keeps the plugin's script away from the
administrator's session (the page is on the plugin's own origin, with its own
sign-in), but it is seamless, as Shopify's admin apps and Salesforce Canvas
are: the page has no inner scrollbar, the frame grows to the page, and the
dashboard's heading and tab row are the only ones. The kit does the page's
half with no plugin code; the host (the dashboard) does the rest.

**Framed, when the host says so.** The host says a page is framed on first
load with `om-framed=1` on the frame's address (so the first paint is already
framed), and in its theme message with `"framed": true` (version 3), which it
sends on every load of the frame; `"framed": false` undoes it. `om-framed=0`,
or no word at all, is a page on its own. The host's word is taken only when
the page is in a frame (`window.parent !== window`), and a message only from
the parent window, as any theme message; being in a frame alone is not enough.
The last word is kept for the tab with the theme, so a navigation inside the
frame that drops the query (a form's redirect) stays framed. A framed page
has `data-om-framed` on `<html>`, and `window.Meridian.frame.framed()` says so.

**The framed look.** With `data-om-framed`, the kit's CSS

- hides the page's own heading: the `h1` (or `.om-page-title`) of its
  `.page-head` (or `.pagehead`). The rest of the head stays: the line under
  the heading and the `.actions`. A head holding nothing but a plain heading
  goes whole;
- hides the page's tab row: a `.tabs` inside the head, or straight after it.
  A `.tabs` further down is the page's content and stays;
- removes `.page`'s standalone padding, centring and `max-width`;
- makes the body's background transparent, so the dashboard's page colour
  shows through;

- hides the head's header actions (below), and the one-button
  `form.inline` holding one;
- hides the head's header status (below), an `om-status` marked
  `data-om-header`;
- drops a head left with nothing to show once those are gone (below), with
  the gap under it, so the page starts right under the host's tabs;

and nothing else. A page not framed looks exactly as it did.

So a page benefits by drawing its heading and its tab row with the kit, in
that shape:

```html
<main class="page">
  <header class="page-head">
    <div><h1>Connections</h1><p>Reading SnapTrade. Last read 12:04.</p></div>
    <div class="actions"><button class="primary">Connect a brokerage</button></div>
  </header>
  <nav class="tabs">…</nav>          <!-- hidden when framed: the dashboard's tabs replace it -->
  …
</main>
```

A framed page must not size itself by the viewport's height (`vh`, `100%` on
`html` or `body`): the viewport is the frame, whose height follows the page.

**The size message.** A page in a frame watches its document (a
`ResizeObserver` on `<html>`) and posts its height to its parent:

```json
{ "type": "meridian:size", "version": 1, "height": 1284 }
```

`height` is the height of `<html>`'s box in CSS pixels, rounded up to a whole
pixel, so a fraction never leaves a scrollbar. It is posted

- only to the origin the page learned from the host's first theme message
  (that message's `event.origin`, from the parent window, when it is an
  `http` or `https` origin), never to `"*"`; the origin is learned once and
  never changes;
- not at all before that message arrives; the current height at once when it
  does;
- then again only when the rounded height changes, at most once an animation
  frame.

This holds framed or not: a host that sends the theme message gets the size.
A page on its own posts nothing.

**Header actions.** A page's head may hand its buttons to the host, which
draws them in its own header, where the dashboard's own buttons are. The page
marks each one declaratively, and writes no script for it:
`data-om-action="<id>"` on a `button` (or an `input type="submit"`) inside
the head's `.actions`, most often a plain form's submit button:

```html
<header class="page-head">
  <div><h1>Connections</h1><p>Reading SnapTrade.</p></div>
  <div class="actions">
    <form method="post" action="/admin/read" class="inline">
      <input type="hidden" name="csrf" value="…"><button data-om-action="refresh">Refresh</button>
    </form>
  </div>
</header>
```

The id is lower-case letters, digits and hyphens, at most 32; the label is
the button's text (an input's value), its whitespace collapsed, at most 40
characters; `class="primary"` or `class="danger"` is its tone, and a
disabled button (or one in a disabled `fieldset`) is disabled. At most four
are offered, each id once, in the page's order. A button the kit cannot
offer (an id that is not one, a repeat, a fifth, no label or a long one) is
marked `data-om-kept` and stays in the page. A marked button anywhere but the
head's `.actions` is the page's own.

**Icon actions, since 0.8.0.** A `button` also marked `data-om-icon="<name>"`,
with a name the kit knows, is an icon button: the kit's CSS draws it square,
as tall as a button of words, with the icon in the button's own colour, in
place of its words, in the page as in the host's header. Its words stay: they
are its accessible name, and the label the host is told; give it a `title`
of the same words, for a pointer's tooltip. The kit knows one icon:

| Name | Icon |
|---|---|
| `refresh` | a circular arrow, clockwise: read again |

Any other name is no icon: the button is drawn with its words, and the host
is told none. An `input` is never an icon.

```html
<form method="post" action="/read" class="inline">
  <input type="hidden" name="csrf" value="…">
  <button data-om-action="refresh" data-om-icon="refresh" title="Refresh">Refresh</button>
</form>
```

Framed, the kit's CSS hides the offered buttons in the page, and the kit
posts them to the host:

```json
{ "type": "meridian:actions", "version": 1,
  "actions": [{ "id": "refresh", "label": "Refresh", "icon": "refresh" }, { "id": "connect", "label": "Connect a brokerage", "tone": "primary" }] }
```

`tone` is there only as `"primary"` or `"danger"`, `disabled` only as
`true`, and `icon` (since 0.8.0, still version 1: a host that does not know
it draws the label) only as a name the kit knows. It is posted

- only to the origin learned from the host's first theme message, as the size
  is, never to `"*"`, and only while the page is framed;
- with that first theme message (the whole set, even when it is empty);
- then again whenever the set, a label, a tone or a disabled state changes
  (a `MutationObserver`), at most once an animation frame, and only when what
  it would say differs from what it last said. A theme message with
  `"framed": false` sends an empty set, and `"framed": true` the set again.

The host answers a click with

```json
{ "type": "meridian:action", "version": 1, "id": "refresh" }
```

The kit takes it only when `event.source` is its own `window.parent`,
`event.origin` is exactly the learned host origin, the page is framed, and
`id` names a button it offers now that is not disabled. It then clicks the
page's own button: a form posts to the page's own server with its own fields
and token, and a button of the page's script gets its `click`. The host
never sees the form, its token or its answer. On its own, a page's buttons
stay where they are, and nothing is posted. `window.Meridian.frame.actions()`
returns what would be offered.

**Header status.** A page's head may hand its status dot to the host, which
draws it beside the plugin's name, so the dot takes no line of the page's.
The page marks it declaratively, and writes no script for it:
`data-om-header` on an `om-status` anywhere inside the head. It is not handed
up by default: an unmarked `om-status` in the head stays in the page, as it
did in 0.6.0.

```html
<header class="page-head">
  <div><h1>Account links</h1>
    <p><om-status data-om-header state="ok" label="SnapTrade read" at="2026-09-30T13:12:00Z" at-label="Last read">SnapTrade read. Last read 2026-09-30 13:12 UTC.</om-status></p></div>
  <div class="actions">…</div>
</header>
```

The first marked one in the head is offered. Its `state` must be `ok`,
`busy`, `warn` or `error`; its label is its `label` (its whitespace
collapsed; the state's own name when it has none, as `om-status` draws it),
at most 80 characters; its `detail` is cut to 300 characters, ending in an
ellipsis; its `at` is sent in UTC (`toISOString()`) when it reads as
`om-moment` reads a moment, and left out otherwise; its `at-label` (default
"Updated") at most 40 characters, sent only with `at`. `zone` is the page's
and is not sent: the host shows the moment as it shows moments. One the kit
cannot offer (a state not one of the four, a label or an at-label too long)
and every marked one after the first are marked `data-om-kept` and stay in
the page.

Framed, the kit's CSS hides the offered one in the page, and the kit posts it
to the host:

```json
{ "type": "meridian:status", "version": 1, "state": "ok", "label": "SnapTrade read",
  "at": "2026-09-30T13:12:00.000Z", "at_label": "Last read" }
```

`detail` is there only when the page gives one, and `at` and `at_label` only
together, when the page gives a moment it can read. When there is none (the
page has no offered status, it was removed, or the page is no longer framed),
it posts

```json
{ "type": "meridian:status", "version": 1, "state": null }
```

It is posted as the header actions are:

- only to the origin learned from the host's first theme message, never to
  `"*"`, and only while the page is framed;
- with that first theme message (the status, or `state: null` when there is
  none);
- then again whenever the status's attributes change, or it is added or
  removed (a `MutationObserver`), at most once an animation frame, and only
  when what it would say differs from what it last said. A theme message with
  `"framed": false` sends `state: null`, and `"framed": true` the status again.

On its own, a page's status stays where it is, and nothing is posted.
`window.Meridian.frame.status()` returns what would be told, or `null`.

**An empty head goes.** Framed, a head left with nothing to show once the
host draws its heading, its tab row, its header actions and its header
status is marked `data-om-empty` by the kit, and the kit's CSS drops it whole,
its gap with it, so what follows starts at the top of the frame. Nothing to
show is no text but whitespace and no element that draws itself (a control,
an image, another component, a kept action or status); a plain wrapper
(`div`, `p`, `span`) holding nothing else, hidden inputs and a one-button
form holding an offered action count as nothing. The mark follows the page
(a `MutationObserver`), and is set when the page is parsed, before the host
has said anything more than `om-framed=1`. Only when framed: on its own, no
head is marked.

**The host's half.** For each framed page, the host:

1. Frames it with `om-framed=1` beside the theme on its address, and no
   border, no background of its own and no scrolling of its own.
2. Sends `{ "type": "meridian:theme", "version": 3, …, "framed": true }` to
   the frame's window on every `load` of the frame and on every theme change,
   with `postMessage(message, pluginOrigin)`.
3. Takes a message as a size only when `event.source` is that frame's
   `contentWindow`, `event.origin` is exactly the plugin's origin (the one it
   sends the theme to), `data.type` is `"meridian:size"` and `data.version` is
   `1`, and `data.height` is a whole number of at least 0; it sets the frame's
   height to it, capped at a height of its own choosing (the page is the
   plugin's, and a height is only a request).
4. Keeps a height of its own until the first size arrives, so a page on a kit
   without the size message (before 0.2.0) still shows, and the frame is never
   0 tall (a browser may stop rendering a frame it cannot see, and then it
   never measures).
5. Gives the frame the page's `color-scheme` (the person's mode: `light`,
   `dark`, or `light dark` for the system's): where a frame's colour scheme
   differs from its document's, a browser paints the frame opaque, and the
   transparent page would show a white or black box.
6. Takes a message as the page's header actions only under the size's
   guards (`event.source`, the exact origin), with `data.type`
   `"meridian:actions"` and `data.version` `1`, and only in the shape above:
   at most four, each an `id` as above and unique, a `label` string of 1 to
   40 characters, `tone` absent or `"primary"` or `"danger"`, `disabled`
   absent or a boolean, `icon` absent or a string of the id's shape.
   Anything else is refused whole. It draws each as a button in its header,
   the label as text (never as HTML), and drops them on each `load` of the
   frame, until the new page offers its own. An `icon` it knows is drawn as
   that icon (most simply by the kit's CSS: `data-om-icon` on its own
   button), the label the button's `aria-label` and `title`; one it does not
   know, as the label. The header is the same on every page: on the left
   the plugin's name and its status dot right after it; on the right the
   page's actions immediately left of whatever the host draws of its own
   there (the dashboard's level switch), which stays the rightmost, so
   actions grow leftward and never move it.
7. On a click, posts `{ "type": "meridian:action", "version": 1, "id" }` to
   the frame's window with `postMessage(message, pluginOrigin)`, never `"*"`.
8. Takes a message as the page's header status only under the size's guards
   (`event.source` is that frame's `contentWindow`, `event.origin` is exactly
   the plugin's origin), with `data.type` `"meridian:status"` and
   `data.version` `1`, and only in the shape above: `state` `null` (no
   status: it removes its dot), or `state` one of `"ok"`, `"busy"`,
   `"warn"`, `"error"` with a `label` string of 1 to 80 characters (not only
   whitespace), `detail` absent or a string of at most 300, `at` absent or an
   ISO 8601 date-time with its offset (`Z` or `±hh:mm`) of at most 40
   characters that parses, and `at_label` absent or a string of 1 to 40.
   Anything else is refused whole, and the dot it drew stays as it was.
9. Draws the status as a dot right after the plugin's name in its heading, with
   `om-status`'s look and note: most simply the kit's own `om-status`
   (`components/om-status.js`), its `state`, `label`, `detail`, `at` and
   `at-label` set as attributes from the message, or an equivalent drawn the
   same way (a mark per state, never colour alone; the label as the dot's
   name; the note on hover, focus or a tap, with the detail and the moment as
   the dot's description). Every word is set as text, never as HTML. It
   removes the dot on each `load` of the frame, until the new page tells its
   own.

`gallery/host.html` is that host, and `gallery/host.js` all of its script;
it draws the status right after the plugin's name in its heading, with the
kit's `om-status`, and on the right the page's actions (an icon by the kit's
CSS) immediately left of a level switch, which on a phone is a menu naming
the level, so the head stays one row.

## The scheme contract

A scheme is a full set of colour properties for light and dark; type, spacing,
radii and shadows stay the brand's. The data is `contract/scheme.json` (served
as `scheme-contract.json`), read by the kit's check and by the dashboard's,
which refuses a scheme before it saves unless every pair passes.

| Property | Group | Meaning |
|---|---|---|
| `--page` | surface | The ground of the page |
| `--card` | surface | Panels, cards, dialogs, tables and inputs, on page |
| `--hover` | surface | Hover fill for buttons and rows |
| `--backdrop` | surface | Behind an open dialog (translucent) |
| `--ink` | ink | Body text and headings |
| `--ink-soft` | ink | Secondary text, grid cells, the neutral badge |
| `--ink-faint` | ink | Captions, hints, table heads; never on hover |
| `--line` | line | Borders of cards and table heads; dividers |
| `--line-soft` | line | Row dividers; the neutral badge's fill |
| `--line-strong` | line | The edge of a field or a control: inputs, selects, text areas, secondary buttons |
| `--accent` | accent | Links, focus rings, the selected tab, a chart's first series |
| `--accent-wash` | accent | Fill behind accent text or ink: selected rows, accent badges, the info notice |
| `--accent-ink` | accent | Text on an accent fill |
| `--primary` | accent | The primary button's fill |
| `--primary-ink` | accent | Text on the primary button |
| `--buy`, `--buy-wash` | direction | A buy, and up: a rise, a gain; its badge fill (may be translucent, seen over card). Red under red-up |
| `--sell`, `--sell-wash` | direction | A sell, and down: a fall, a loss; its badge fill. Green under red-up |
| `--good`, `--good-wash` | status | Success, healthy, current. Never flips |
| `--danger`, `--danger-wash` | status | Errors and destructive actions. Never flips |
| `--warn-ink`, `--warn-wash` | status | Warnings, things needing attention |
| `--violet`, `--violet-wash` | status | A second category colour; informational badges |

**The pairs.** Each is a text colour on a background, with a kind: `text`
needs 4.5:1, `large-text` 3:1, `ui` (a focus ring, a chart series) 3:1, as
WCAG 2's AA. Text: ink, ink-soft and ink-faint on page and card; ink on hover
and accent-wash; ink-soft on line-soft, hover and accent-wash; accent on page,
card and accent-wash; accent-ink on accent; primary-ink on primary; good,
danger, warn-ink, violet, buy and sell each on card and on their own wash (a
translucent wash is composited over card). UI: accent on page and card;
violet and warn-ink on card; line-strong on page and card (a field's or a
control's edge, WCAG 1.4.11). Buy and sell, good and danger, good and warning,
and danger and warning must also differ by at least 20 (CIE76) so they stay
distinguishable, and buy must differ from good and sell from danger by as
much. `line` and
`line-soft` are decorative dividers and not held to a ratio.

**Both conventions.** A scheme is written for green-up. The check measures it
again under red-up (buy and sell swapped), wherever the swap makes a pair or a
rule new: a sell drawn in the good colour passes green-up and fails red-up,
where it is the colour of a buy (`light, red-up: --buy and --good differ by
0.0 …`).

**The stylesheet.** A scheme is served as `schemes/<id>.css` in exactly this
shape, which `src/lib/scheme.js` renders (`renderSchemeCss`) and the
dashboard renders the same way:

```css
:root { --page: #f3f7f7; --card: #ffffff; /* …every property, light */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-om-mode="light"]) { /* …every property, dark */ }
}
:root[data-om-mode="dark"] { /* …every property, dark, the same values */ }

/* The red-up convention: only the direction properties, swapped. */
:root[data-om-direction="red-up"] { --buy: /* light sell */; --buy-wash: …; --sell: …; --sell-wash: …; }
@media (prefers-color-scheme: dark) {
  :root[data-om-direction="red-up"]:not([data-om-mode="light"]) { /* the same, dark */ }
}
:root[data-om-mode="dark"][data-om-direction="red-up"] { /* the same, dark */ }
```

A value is `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` or `rgba()`; the check
refuses anything else rather than guess. To check one:

```sh
node tools/check-scheme.mjs my-scheme.css      # or a { "light": {…}, "dark": {…} } .json
```

It prints every failing pair, for example
`dark: --primary-ink on --primary is 1.00:1, below 4.5:1 for text (the primary button)`.
In script, `checkScheme(scheme, contract)` from `lib/contrast.js` returns
`{ ok, problems, results }`.

**The brand default** is generated from meridian-design's `brand/tokens.json`,
each property from the token `contract/scheme.json` names (`brand`): every one
is the token of the same name, `--primary`, `--primary-ink`, `--line-strong`
and the light `--buy` and `--sell` included. `schemes/harbour.json` is a
sample administrator's scheme, held to the contract by the build.

## Building and checking

The host needs only Docker: the build, lint and tests run in a container
(Node 22, and happy-dom for the tests; both pinned), and the benchmark in
Playwright's (Chromium, pinned).

| | |
|---|---|
| `make ci-local` | Every gate: `check-tokens`, then `build`, `lint`, `test`, `bench`. The pre-push hook runs it |
| `make ci-remote` | What CI runs: `build`, `lint`, `test`, `bench` (meridian-design is private, so no `check-tokens`) |
| `make build` | `generated/` from `../meridian-design/brand/tokens.json` when it is there (`DESIGN=` to point elsewhere), then `dist/<version>/` |
| `make check-tokens` | Fails when `generated/` differs from the tokens |
| `make lint` | Scripts parse; no raw colour in anything hand-written; every `var(--…)` is defined; nothing served names another origin or an absolute path |
| `make test` | The tests: the generator reproduces the tokens exactly, the default scheme passes under both direction conventions, a bad scheme fails naming its pairs, the components render and behave (the high-rate grid and the panels included), the theme (and the direction convention) follows only the parent frame, red-up swaps buy and sell and no status colour, `om-live` resumes after a gap, the size message goes only to the host's learned origin and only on a change, the framed marker is the host's word in a frame, the framed look hides only the heading and the tab row, and a page on its own computes as it did; the header actions and the header status go to the host's origin alone, in their shape, only on a change, and cleared when unframed, one the kit cannot offer kept in the page; a head left empty once the host draws its parts is dropped, framed only; the account map's states, search, filters, groups, pages, chooser, suggestions, several links, forms and `om-link`; the grid's declared JSON, rich cells and narrow layouts; list rows wrapping; options and the field row; `om-moment`; `om-status`'s states, marks, note, words as text and reduced motion; the account map's Status column and filter by state; each of the [patterns](#patterns) here is the gallery's patterns page's, and its head, framed, hands the host its icon action and its status and is left empty; the entry grid's column types and their words, paths, CSV and pasted cells read as a spreadsheet writes them, exact sums, its table, names, blank rows, rows added and removed, the keyboard, cells checked as typed, a held submit, the server's messages by path, rules, a paste, the CSV dialog, the page's own table posting the same names without the kit, and its cards at a phone's width |
| `make bench` | The high-rate grid's budget, the account map's at 2,000 and 1,500 accounts, and the entry grid's (typing a number into 1,000 rows, and a cell's message coming and going in 100, every rule run on each key) with its checks in a real page (script off, the page's own table posts; with script, checked as typed, a held submit, the server's messages, a paste, rows added and removed, the post by path; at 390px cards, 44px targets and nothing sideways, light and dark), in a real browser: headless Chromium, driven by Playwright (the image and `playwright-core` pinned together, in `Dockerfile.check` and `package-lock.json`). It prints what it measured, to `.bench.log` too, and fails when the budget is not held |
| `make serve` | The gallery at `http://127.0.0.1:8765/.meridian/ui/<version>/gallery.html`, under the dashboard's base path |
| `make install-hooks` | Point git at `hooks/`, so a push runs `ci-local` |

The build (`tools/build.mjs --tokens <path>`) is the only thing that reads
`tokens.json`. It writes `generated/tokens.css` (spacing, radii, shadows, type)
and `generated/schemes/default.css` (the brand default scheme), which are
committed: meridian-design is private, so CI and the dashboard's image build
the kit from them, and meridian-design's check-brand holds them to the tokens.
Never edit them by hand; change the token and run `make build`.

## Releasing

The version is `package.json`'s, and the build writes the kit to
`dist/<version>/`. Nothing is published from here: meridian-core's image
builds the kit from this repository at the commit its `Dockerfile` pins
(`MERIDIAN_UI_REV`), and the dashboard serves it at `/.meridian/ui/<version>/`,
answering a request for any 0.x with the newest 0.x it carries. So a release is
a version raised here, then that pin moved in meridian-core; a deployment has
it once it runs a runtime image carrying it.

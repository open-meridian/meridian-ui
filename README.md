# meridian-ui

Open Meridian's plugin UI kit. A plugin's page links it and looks like Open
Meridian with no design work: the brand's type, spacing, radii and shadows;
the person's colour scheme, light or dark, and their market-direction
convention (green-up or red-up), handed over by the dashboard's frame; the platform's components in CSS; and web components for what trading
pages need: a data grid (with a high-rate mode for streams, and a layout for a
phone), charts, an as-of control and an as-of moment, a status dot, an instrument picker, a
live feed that never misses a change, resizable, rearrangeable panels, and the
map a plugin links its external accounts with.

It is framework-free: CSS and custom elements, used the same way from plain
HTML, React, Vue or Svelte. It has no runtime dependencies and loads nothing
from anywhere but itself. The design is meridian-design's
`spec/plugin-pages-share-one-kit.md`. This is release 0.6.0; the guide to
building a plugin's page with it is at
[open-meridian.dev](https://open-meridian.dev/how-to/build-a-plugin-page/).

- [Linking the kit](#linking-the-kit)
- [Never raw colours](#never-raw-colours)
- [CSS components](#css-components)
- [Web components](#web-components): [data without script](#data-without-script), [om-grid](#om-grid) (and its [rich cells](#rich-cells), [narrow layouts](#narrow-layouts) and [high-rate mode](#high-rate-mode)), [om-chart](#om-chart), [om-asof](#om-asof), [om-moment](#om-moment), [om-status](#om-status), [om-instrument-picker](#om-instrument-picker), [om-live](#om-live), [om-panels](#om-panels), [om-account-map](#om-account-map)
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
  <link rel="stylesheet" href="/.meridian/ui/0.6.0/meridian.css">
  <script src="/.meridian/ui/0.6.0/meridian.js"></script>
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
| `gallery.html` | Every component, light and dark, in each scheme shipped, green-up or red-up; the sample page framed seamlessly by a stand-in host (`gallery/host.html`) beside it on its own; and a plugin's account links page (`gallery/accounts.html`, tags and JSON with no script of its own) at the gallery's width and at 390px, on its own and framed |

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
optional `status` and `values`, a Status column and a filter by state.

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
`{ "columns": […], "rows": […] }` this way and `om-account-map` its data. The
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
| `create` | `external_account_id`, `new_account_name` (required, the external account's name to start), `new_account_custodian`, `new_account_type` (prefilled, may be emptied) | Create and link |
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

Framed, the kit's CSS hides the offered buttons in the page, and the kit
posts them to the host:

```json
{ "type": "meridian:actions", "version": 1,
  "actions": [{ "id": "refresh", "label": "Refresh" }, { "id": "connect", "label": "Connect a brokerage", "tone": "primary" }] }
```

`tone` is there only as `"primary"` or `"danger"`, and `disabled` only as
`true`. It is posted

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
   absent or a boolean. Anything else is refused whole. It draws each as a
   button in its header, the label as text (never as HTML), and drops them
   on each `load` of the frame, until the new page offers its own.
7. On a click, posts `{ "type": "meridian:action", "version": 1, "id" }` to
   the frame's window with `postMessage(message, pluginOrigin)`, never `"*"`.

`gallery/host.html` is that host, and `gallery/host.js` all of its script.

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
| `make test` | The tests: the generator reproduces the tokens exactly, the default scheme passes under both direction conventions, a bad scheme fails naming its pairs, the components render and behave (the high-rate grid and the panels included), the theme (and the direction convention) follows only the parent frame, red-up swaps buy and sell and no status colour, `om-live` resumes after a gap, the size message goes only to the host's learned origin and only on a change, the framed marker is the host's word in a frame, the framed look hides only the heading and the tab row, and a page on its own computes as it did; the account map's states, search, filters, groups, pages, chooser, suggestions, several links, forms and `om-link`; the grid's declared JSON, rich cells and narrow layouts; list rows wrapping; options and the field row; `om-moment`; `om-status`'s states, marks, note, words as text and reduced motion; the account map's Status column and filter by state |
| `make bench` | The high-rate grid's budget, and the account map's at 2,000 and 1,500 accounts, in a real browser: headless Chromium, driven by Playwright (the image and `playwright-core` pinned together, in `Dockerfile.check` and `package-lock.json`). It prints what it measured, to `.bench.log` too, and fails when the budget is not held |
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

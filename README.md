# meridian-ui

Open Meridian's plugin UI kit. A plugin's page links it and looks like Open
Meridian with no design work: the brand's type, spacing, radii and shadows;
the person's colour scheme, light or dark, and their market-direction
convention (green-up or red-up), handed over by the dashboard's frame; the platform's components in CSS; and web components for what trading
pages need: a data grid (with a high-rate mode for streams), charts, an as-of
control, an instrument picker, a live feed that never misses a change, and
resizable, rearrangeable panels.

It is framework-free: CSS and custom elements, used the same way from plain
HTML, React, Vue or Svelte. It has no runtime dependencies and loads nothing
from anywhere but itself. The design is meridian-design's
`spec/plugin-pages-share-one-kit.md`.

- [Linking the kit](#linking-the-kit)
- [Never raw colours](#never-raw-colours)
- [CSS components](#css-components)
- [Web components](#web-components): [om-grid](#om-grid) (and its [high-rate mode](#high-rate-mode)), [om-chart](#om-chart), [om-asof](#om-asof), [om-instrument-picker](#om-instrument-picker), [om-live](#om-live), [om-panels](#om-panels)
- [The theme: the frame's message](#the-theme-the-frames-message)
- [The frame: seamless](#the-frame-seamless)
- [The scheme contract](#the-scheme-contract)
- [Building and checking](#building-and-checking)

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
  <link rel="stylesheet" href="/.meridian/ui/0.2.0/meridian.css">
  <script src="/.meridian/ui/0.2.0/meridian.js"></script>
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
| `gallery.html` | Every component, light and dark, in each scheme shipped, green-up or red-up; and the sample page framed seamlessly by a stand-in host (`gallery/host.html`) beside it on its own |

The kit's CSS is in cascade layers (`meridian.scheme`, `meridian.tokens`,
`meridian.base`, `meridian.components`), so a page's own rules win without a
specificity contest.

**From a framework.** The components are custom elements: render them like
any element, set their data as properties, and listen for their events.
React 19 sets properties on custom elements directly; before 19, set
`columns`, `rows` and `series` through a ref. Vue: `<om-grid :columns.prop="cols">`
(and `compilerOptions.isCustomElement: (t) => t.startsWith("om-")`). Svelte
sets properties by default. A framework must not render children inside an
`om-*` element: each one draws its own.

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
| `.panel`, `.card` | A card on page. `.panel.padded` pads it; `.panel.narrow`; `.panel-section` is a divided section inside; `.list-row` rows with `.grow`, `.title`, `.meta`; `.empty-state` |
| `table`, `.table-wrap` | Tables as the platform draws them; `table.dense` for a dense one; `th.num`, `td.num` right-align figures; `tr.picked` or `tr[aria-selected=true]` for a selected row |
| `button`, `.button` | `.primary`, `.danger`, `.link`, `.small`, `.icon`; `form.inline` for a one-button form |
| `.badge` (or `.pill`) | Neutral, `.good`, `.warn`, `.bad`, `.accent`, `.info`, `.buy`, `.sell`; `.dot` inside for a status dot |
| `.notice` | `.info`, `.bad`, `.warn`, `.good`, `.quiet` (a `<details class="notice quiet">` folds) |
| `.tabs` with `.tab` | The current tab is `.on`, `[aria-current=page]` or `[aria-selected=true]`; `.count` inside |
| `.field` | A label: `<label class="field"><span>Name</span><input><span class="hint">…</span></label>`; `aria-invalid="true"` marks a bad value; `.filters` is a row of controls; `.grid-2`, `.grid-3`. A field's and a secondary button's edge is `--line-strong` (3:1) |
| `.tiles` with `.panel.tile` | Figures: `.tile-label`, `.tile-value`, `.tile-delta` |
| `.menu`, `.menu-pop`, `dialog` | A `<details class="menu">` menu, and dialogs with `.dialog-head`, `.dialog-body`, `.dialog-foot` |
| `.chips`, `.chip` | Removable filters |
| Text | `.muted`, `.faint`, `.hint`, `.mono`, `.num`; `.bad-ink`, `.good-ink`, `.warn-ink`, `.buy-ink`, `.sell-ink`; `.row` and `.spacer`; `ul.plain`; `.visually-hidden` |

## Web components

Every component reaches the network only on the page's own origin (the
plugin's server, which proxies anything further): a URL on any other origin
is refused with an `om-error` event, never fetched. Figures are shown as the
strings the plugin sent and sorted exactly, never through floating point.

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

| Property or method | |
|---|---|
| `columns` | `[{ key, label, type, align, sortable, group, tone, format, compare, width }]`. `type` is `text` (default), `decimal` or `number` (right-aligned, tabular, sorted exactly), `badge`, `code` or `date`. `group: true` groups a decimal's digits (`1,234.50`, nothing rounded). `tone: "sign"` colours a figure buy (up) or sell (down) by its sign, following the person's convention; for a badge, `tone(value, row)` returns `good`, `warn`, `bad`, `accent`, `info`, `buy` or `sell`. `format(value, row)` returns text or a node; `compare(a, b)` overrides the sort |
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
| `make test` | The tests: the generator reproduces the tokens exactly, the default scheme passes under both direction conventions, a bad scheme fails naming its pairs, the components render and behave (the high-rate grid and the panels included), the theme (and the direction convention) follows only the parent frame, red-up swaps buy and sell and no status colour, `om-live` resumes after a gap, the size message goes only to the host's learned origin and only on a change, the framed marker is the host's word in a frame, the framed look hides only the heading and the tab row, and a page on its own computes as it did |
| `make bench` | The high-rate grid's budget in a real browser: headless Chromium, driven by Playwright (the image and `playwright-core` pinned together, in `Dockerfile.check` and `package-lock.json`). It prints what it measured, to `.bench.log` too, and fails when the budget is not held |
| `make serve` | The gallery at `http://127.0.0.1:8765/.meridian/ui/<version>/gallery.html`, under the dashboard's base path |
| `make install-hooks` | Point git at `hooks/`, so a push runs `ci-local` |

The build (`tools/build.mjs --tokens <path>`) is the only thing that reads
`tokens.json`. It writes `generated/tokens.css` (spacing, radii, shadows, type)
and `generated/schemes/default.css` (the brand default scheme), which are
committed: meridian-design is private, so CI and the dashboard's image build
the kit from them, and meridian-design's check-brand holds them to the tokens.
Never edit them by hand; change the token and run `make build`.

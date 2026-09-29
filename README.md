# meridian-ui

Open Meridian's plugin UI kit. A plugin's page links it and looks like Open
Meridian with no design work: the brand's type, spacing, radii and shadows;
the person's colour scheme, light or dark, handed over by the dashboard's
frame; the platform's components in CSS; and web components for what trading
pages need: a data grid, charts, an as-of control, an instrument picker and a
live feed that never misses a change.

It is framework-free: CSS and custom elements, used the same way from plain
HTML, React, Vue or Svelte. It has no runtime dependencies and loads nothing
from anywhere but itself. The design is meridian-design's
`spec/plugin-pages-share-one-kit.md`.

- [Linking the kit](#linking-the-kit)
- [Never raw colours](#never-raw-colours)
- [CSS components](#css-components)
- [Web components](#web-components): [om-grid](#om-grid), [om-chart](#om-chart), [om-asof](#om-asof), [om-instrument-picker](#om-instrument-picker), [om-live](#om-live)
- [The theme: the frame's message](#the-theme-the-frames-message)
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
  <link rel="stylesheet" href="/.meridian/ui/0.1.0/meridian.css">
  <script src="/.meridian/ui/0.1.0/meridian.js"></script>
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
only its content, inside `.page`.

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
| `gallery.html` | Every component, light and dark, in each scheme shipped |

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
| `.field` | A label: `<label class="field"><span>Name</span><input><span class="hint">…</span></label>`; `aria-invalid="true"` marks a bad value; `.filters` is a row of controls; `.grid-2`, `.grid-3` |
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

| Property or method | |
|---|---|
| `columns` | `[{ key, label, type, align, sortable, group, tone, format, compare, width }]`. `type` is `text` (default), `decimal` or `number` (right-aligned, tabular, sorted exactly), `badge`, `code` or `date`. `group: true` groups a decimal's digits (`1,234.50`, nothing rounded). `tone: "sign"` colours a figure buy or sell by its sign; for a badge, `tone(value, row)` returns `good`, `warn`, `bad`, `accent`, `info`, `buy` or `sell`. `format(value, row)` returns text or a node; `compare(a, b)` overrides the sort |
| `setRows(rows)` / `rows` | Replace every row (a snapshot) |
| `upsert(row or rows)` | Insert or replace by key, on the next frame; the last state per key wins |
| `remove(key or keys)` | Remove by key, on the next frame |
| `flush()` | Apply queued updates now |
| `sortBy(key, "ascending" \| "descending")`, `sort` | Sort in script |
| `getRow(key)` | A row by key |

| Event | `detail` |
|---|---|
| `om-sort` | `{ key, direction }`, when a header is clicked. Cancel it (`preventDefault`) to sort on the server and `setRows` the result |
| `om-row` | `{ key, row }`, when a row is clicked |

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

## The theme: the frame's message

The dashboard frames a plugin's page and hands it the person's colour scheme
and mode; `meridian.js` applies them, and the plugin writes no code for it.

**On first load**, as query parameters on the framed page's URL:

```
?om-scheme=<id>&om-mode=<light|dark|system>
```

**On change**, as a message from the dashboard's frame to the page's window,
with `postMessage(message, pluginOrigin)`:

```json
{ "type": "meridian:theme", "version": 1, "scheme": "harbour", "mode": "dark" }
```

`scheme` is an id (lower-case letters, digits and hyphens, at most 64) and
`mode` is `light`, `dark` or `system`; either may be left out to keep the
current one, and an invalid value is ignored rather than guessed. The
dashboard is the only sender: the page accepts the message only when
`event.source` is its own `window.parent`, and never when it is not framed.
The dashboard should also send the message on each `load` of the frame, so a
navigation inside the frame follows the person's theme; the kit keeps the last
theme for the tab (`sessionStorage`) as well, so that navigation does not
flash.

Applying a theme sets `data-om-mode` and `data-om-scheme` on `<html>`, links
`schemes/<id>.css` from the kit's own base path (never another), and fires
`om-theme` on `window` with `detail: { scheme, mode, resolved }` (`resolved`
is `light` or `dark`, following the system under `system`). The brand default
is always underneath: a scheme that fails to load is dropped and the page is
the brand's. `window.Meridian.theme.apply(scheme, mode)` and
`window.Meridian.theme.current()` are there for a page that must know, such as
one drawing on a canvas.

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
| `--line` | line | Borders of cards, inputs and table heads |
| `--line-soft` | line | Row dividers; the neutral badge's fill |
| `--accent` | accent | Links, focus rings, the selected tab, a chart's first series |
| `--accent-wash` | accent | Fill behind accent text or ink: selected rows, accent badges, the info notice |
| `--accent-ink` | accent | Text on an accent fill |
| `--primary` | accent | The primary button's fill |
| `--primary-ink` | accent | Text on the primary button |
| `--buy`, `--buy-wash` | semantic | A buy, a gain; its badge fill (may be translucent, seen over card) |
| `--sell`, `--sell-wash` | semantic | A sell, a loss; its badge fill |
| `--good`, `--good-wash` | semantic | Success, healthy, current |
| `--danger`, `--danger-wash` | semantic | Errors and destructive actions |
| `--warn-ink`, `--warn-wash` | semantic | Warnings, things needing attention |
| `--violet`, `--violet-wash` | semantic | A second category colour; informational badges |

**The pairs.** Each is a text colour on a background, with a kind: `text`
needs 4.5:1, `large-text` 3:1, `ui` (a focus ring, a chart series) 3:1, as
WCAG 2's AA. Text: ink, ink-soft and ink-faint on page and card; ink on hover
and accent-wash; ink-soft on line-soft, hover and accent-wash; accent on page,
card and accent-wash; accent-ink on accent; primary-ink on primary; good,
danger, warn-ink, violet, buy and sell each on card and on their own wash (a
translucent wash is composited over card). UI: accent on page and card;
violet and warn-ink on card. Buy and sell, good and danger, good and warning,
and danger and warning must also differ by at least 20 (CIE76) so they stay
distinguishable. Borders (`line`, `line-soft`) are decorative and not held to
a ratio; a field is identified by its label.

**The stylesheet.** A scheme is served as `schemes/<id>.css` in exactly this
shape, which `src/lib/scheme.js` renders (`renderSchemeCss`) and the
dashboard renders the same way:

```css
:root { --page: #f3f7f7; --card: #ffffff; /* …every property, light */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-om-mode="light"]) { /* …every property, dark */ }
}
:root[data-om-mode="dark"] { /* …every property, dark, the same values */ }
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
each property from the token `contract/scheme.json` names (`brand`). Most are
the token of the same name; four differ by mode: `--primary` is `accent` in
light and `accent-bright` in dark, and `--primary-ink` is `accent-ink` and
`paper` (white), as the platform's primary button; `--buy` and `--sell` (and
their washes) are `good` and `danger` in light, because the brand's `buy`
and `sell` tokens are drawn for the public page's navy and fall below 4.5:1 on
a light card, and `buy` and `sell` in dark. `schemes/harbour.json` is a
sample administrator's scheme, held to the contract by the build.

## Building and checking

The host needs only Docker: the build, lint and tests run in a container
(Node 22, and happy-dom for the tests; both pinned).

| | |
|---|---|
| `make ci-local` | Every gate: `check-tokens`, then `build`, `lint`, `test`. The pre-push hook runs it |
| `make ci-remote` | What CI runs: `build`, `lint`, `test` (meridian-design is private, so no `check-tokens`) |
| `make build` | `generated/` from `../meridian-design/brand/tokens.json` when it is there (`DESIGN=` to point elsewhere), then `dist/<version>/` |
| `make check-tokens` | Fails when `generated/` differs from the tokens |
| `make lint` | Scripts parse; no raw colour in anything hand-written; every `var(--…)` is defined; nothing served names another origin or an absolute path |
| `make test` | The tests: the generator reproduces the tokens exactly, the default scheme passes, a bad scheme fails naming its pairs, the components render and behave, the theme follows only the parent frame, `om-live` resumes after a gap |
| `make serve` | The gallery at `http://127.0.0.1:8765/.meridian/ui/<version>/gallery.html`, under the dashboard's base path |
| `make install-hooks` | Point git at `hooks/`, so a push runs `ci-local` |

The build (`tools/build.mjs --tokens <path>`) is the only thing that reads
`tokens.json`. It writes `generated/tokens.css` (spacing, radii, shadows, type)
and `generated/schemes/default.css` (the brand default scheme), which are
committed: meridian-design is private, so CI and the dashboard's image build
the kit from them, and meridian-design's check-brand holds them to the tokens.
Never edit them by hand; change the token and run `make build`.

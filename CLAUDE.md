# meridian-ui

Open Meridian's plugin UI kit: the brand's tokens as CSS custom properties,
component CSS, and web components, served by the dashboard at
`/.meridian/ui/<version>/` on every plugin host. The design is
meridian-design's `spec/plugin-pages-share-one-kit.md` (accepted, Q1 to Q7
ruled); read it before changing what the kit is.

## Rules with teeth

- **Framework-free, and independent of the plugin's language**
  (meridian-design decisions/025). Every component is HTML5, CSS and standard
  JavaScript the browser runs natively, usable from plain HTML, React, Vue or
  Svelte, from a plugin written in any language. No framework, no bundler or
  transpiler in the page, no backend of its own, no runtime dependency.
- **Data without script.** A page in any language gives a component its data
  as JSON in a child `<script type="application/json">` and writes no script
  (`src/lib/declared.js`); a column option or a component's data that only a
  function can say is a convenience beside that, never the only way in. A 0.x
  release only adds: nothing removed or renamed.
- **Nothing from elsewhere.** Everything works under the base path the
  dashboard serves it at, with relative references only: no CDN, no absolute
  path, no other origin. A component that reaches the network reaches only the
  page's own origin (`src/lib/url.js`). `make lint` fails otherwise.
- **Never a raw colour.** Every colour is a scheme property, `var(--…)`, from
  `contract/scheme.json`. `make lint` fails on a hex, an `rgb()` or a named
  colour in anything hand-written.
- **brand/tokens.json is the source.** `generated/` is made from
  meridian-design's tokens by `make build` and committed, because
  meridian-design is private; never edit it by hand. `make check-tokens` (in
  ci-local) and meridian-design's check-brand hold it to the tokens.
- **Colour schemes are data.** A scheme is the contract's colour properties
  for light and dark, rendered by `src/lib/scheme.js` into the template the
  dashboard also renders. Every text/background pair in the contract passes
  WCAG AA (4.5:1 text, 3:1 large text and UI) or the scheme is refused. Type,
  spacing, radii and shadows are the brand's, never a scheme's.
- **The frame owns the theme.** The dashboard hands the page its scheme, mode
  and market-direction convention by query (`om-scheme`, `om-mode`,
  `om-direction`) and by a `meridian:theme` message from the parent window;
  `src/meridian.js` applies them and accepts a message from the parent only.
  A plugin writes no theme code and cannot override it.
- **Seamless in the frame, on the host's word.** A page is framed
  (`data-om-framed`) only when it is in a frame and the host says so
  (`om-framed=1`, or `framed` in the theme message); the kit's CSS then hides
  only the head's heading, the tab row under it and the header actions the
  host draws, and every framed rule is
  under that attribute. The page posts `meridian:size` only to the origin
  learned from the host's first theme message, never `*`, and there too its
  header actions (`meridian:actions`, from `data-om-action` buttons in the
  head's `.actions`); it presses one only on the parent's `meridian:action`
  from that origin, so the page's form posts with its own token. README, "The
  frame: seamless", is the protocol the dashboard implements.
- **Direction apart from status.** Red-up swaps only the direction colours
  (buy and sell, and their washes, per the contract's `direction`); good,
  danger and warning never flip. The check measures a scheme under both
  conventions.
- **Exact decimal for money.** A price or quantity is shown as the string the
  plugin sent and sorted exactly (`src/lib/decimal.js`); never `parseFloat`
  it. A chart places points as numbers; its tooltip shows the given string.
- **The contract is shared.** `contract/scheme.json` is read by the dashboard's
  server-side check (Rust) too: change a property or a pair there and in the
  dashboard together.

## Verification

    make ci-local

Build, lint and tests run in a container (the host has no Node). `make serve`
shows the gallery under `/.meridian/ui/<version>/`. The pre-push hook runs
ci-local; `make install-hooks` activates it.

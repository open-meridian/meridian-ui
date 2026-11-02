/* The gallery's stand-in for a plugin's own server, so the gallery runs from
 * static files. A real plugin page has nothing like this: its server answers
 * these three URLs, as the README describes.
 *
 *   search          GET ?q=&limit=&as_of=  ->  { results: [InstrumentRecord…] }
 *   snapshot.json   GET                    ->  { sequence, rows }
 *   events          text/event-stream      ->  id: <sequence>, data: { rows }
 *   rates/live      GET                    ->  { sequence, rows, now_ms }: live values
 *   rates/live/events  text/event-stream   ->  id: <sequence>, data: { rows, sent_ms }
 *
 * The rates are an SDK's pages.live_values as a page receives them (0.16.0's
 * om-live cells): each value with its source dataset, its confirmed time and
 * when it is stale, closed out of session, or why it has nothing to show.
 *
 * Prices are integer cents and quantities integers, formatted as decimal
 * strings: never floating point for money, even in a demonstration. Every
 * twentieth delivery skips a sequence number, so the page shows om-live
 * catching up from the snapshot.
 */
(function () {
  "use strict";
  var realFetch = window.fetch.bind(window);

  var INSTRUMENTS = [
    ["INS-3f1c9a02", "Apple Inc. common stock", "equity", "USD", "XNAS", [["ticker", "AAPL"], ["isin", "US0378331005"], ["figi", "BBG000B9XRY4"]]],
    ["INS-8d20b7e4", "Microsoft Corporation common stock", "equity", "USD", "XNAS", [["ticker", "MSFT"], ["isin", "US5949181045"]]],
    ["INS-c4a61f90", "Alphabet Inc. class A", "equity", "USD", "XNAS", [["ticker", "GOOGL"], ["isin", "US02079K3059"]]],
    ["INS-12e9d3b7", "Amazon.com, Inc. common stock", "equity", "USD", "XNAS", [["ticker", "AMZN"], ["isin", "US0231351067"]]],
    ["INS-5b7730c1", "NVIDIA Corporation common stock", "equity", "USD", "XNAS", [["ticker", "NVDA"], ["isin", "US67066G1040"]]],
    ["INS-a90e44d2", "ASML Holding N.V.", "equity", "EUR", "XAMS", [["ticker", "ASML"], ["isin", "NL0010273215"]]],
    ["INS-0f3b82aa", "iShares Core S&P 500 ETF", "etf", "USD", "ARCX", [["ticker", "IVV"], ["isin", "US4642872000"]]],
    ["INS-77c1e0f5", "US Treasury 4.25% 2034", "bond", "USD", "", [["cusip", "91282CKQ3"], ["isin", "US91282CKQ32"]]]
  ].map(function (r) {
    return {
      instrument_id: r[0], description: r[1], asset_class: r[2], currency: r[3], exchange_mic: r[4],
      identifiers: r[5].map(function (i) { return { scheme: i[0], value: i[1], source: "" }; })
    };
  });

  function money(cents) {
    var neg = cents < 0;
    var a = Math.abs(cents);
    var s = String(Math.floor(a / 100)) + "." + String(a % 100).padStart(2, "0");
    return (neg ? "-" : "") + s;
  }

  // position_id, account, ticker, quantity, price in cents, previous close in cents
  var book = [
    ["POS-1", "Main", "AAPL", 1200, 22841, 22710],
    ["POS-2", "Main", "MSFT", 450, 51220, 51475],
    ["POS-3", "Main", "NVDA", 2000, 17866, 17512],
    ["POS-4", "Retirement", "IVV", 800, 66105, 66020],
    ["POS-5", "Retirement", "ASML", 60, 70150, 71010],
    ["POS-6", "Trading", "AMZN", -300, 22010, 21875],
    ["POS-7", "Trading", "GOOGL", 900, 24533, 24390],
    ["POS-8", "Main", "US 4.25% 2034", 100000, 9912, 9920]
  ].map(function (r) { return { id: r[0], account: r[1], symbol: r[2], qty: r[3], px: r[4], prev: r[5] }; });

  function row(p) {
    return {
      position_id: p.id,
      account: p.account,
      symbol: p.symbol,
      quantity: String(p.qty),
      price: money(p.px),
      market_value: money(p.qty * p.px),
      day_pnl: money(p.qty * (p.px - p.prev)),
      state: p.qty < 0 ? "Short" : "Long"
    };
  }

  var sequence = 1000;
  var sources = [];

  function isRates(s) { return /rates\/live\/events$/.test(new URL(s.url, location.href).pathname); }

  function tick() {
    var p = book[Math.floor(Math.random() * book.length)];
    p.px = Math.max(1, p.px + Math.round((Math.random() - 0.5) * 60));
    sequence += 1;
    if (sequence % 20 === 0) return; // dropped on the way: the page sees a gap
    var data = JSON.stringify({ rows: [row(p)] });
    sources.forEach(function (s) { if (!isRates(s)) s._deliver(String(sequence), data); });
  }

  // pair, mid in 1e-5 (pips), the prior cut's mid, its source; and how it is:
  // live (ticking), stale (its feed silent), closed (out of its session),
  // unlimited (a reference rate, no stale limit declared), missing (why).
  var started = Date.now();
  var rates = [
    ["EUR/USD", 108420, 108290, "oanda-1:quotes", "live"],
    ["USD/JPY", 15211000, 15240000, "oanda-1:quotes", "live"],
    ["GBP/USD", 129850, 129900, "kraken-1:quotes", "stale"],
    ["USD/TRY", 3421000, 3418000, "oanda-1:quotes", "closed"],
    ["EUR/GBP", 83410, 83520, "ecb-1:ecb_fx", "unlimited"],
    ["AUD/USD", 0, 0, "", "missing"]
  ].map(function (r) {
    var at = r[4] === "stale" ? started - 42000 : r[4] === "closed" ? started - 3 * 3600000 : r[4] === "unlimited" ? started - 20 * 3600000 : started - 800;
    return { pair: r[0], mid: r[1], prev: r[2], source: r[3], how: r[4], at: at, recorded: at + 3 };
  });
  var rateSequence = 0;

  function pips(v, places) {
    var s = String(v).padStart(places + 1, "0");
    return s.slice(0, s.length - places) + "." + s.slice(s.length - places);
  }

  function rateRow(r) {
    // Prices in 1e-5; a yen or lira pair is shown to 3 places, others to 5.
    var places = r.pair.indexOf("JPY") >= 0 || r.pair.indexOf("TRY") >= 0 ? 3 : 5;
    if (r.how === "missing") {
      return { key: "rate:" + r.pair, f: { pair: r.pair, mid: "–", chg: "–" }, tone: {}, title: r.pair, source: "",
        at_ms: 0, stale_at_ms: 0, closed: false, recorded_ms: 0, why: "no AUD/USD quote is entitled" };
    }
    var chg = Math.round(((r.mid - r.prev) * 10000) / r.prev) / 100;
    return {
      key: "rate:" + r.pair,
      f: { pair: r.pair, mid: pips(Math.round(r.mid / Math.pow(10, 5 - places)), places), chg: (chg > 0 ? "+" : "") + chg.toFixed(2) + "%" },
      tone: { chg: chg > 0 ? "up" : chg < 0 ? "down" : "" },
      title: r.pair + " mid " + pips(Math.round(r.mid / Math.pow(10, 5 - places)), places),
      source: r.source,
      at_ms: r.at,
      stale_at_ms: r.how === "unlimited" ? 0 : r.at + 5000,
      closed: r.how === "closed",
      recorded_ms: r.recorded,
      why: ""
    };
  }

  function rateTick() {
    var live = rates.filter(function (r) { return r.how === "live"; });
    var r = live[Math.floor(Math.random() * live.length)];
    r.mid = Math.max(1, r.mid + Math.round((Math.random() - 0.5) * 12));
    r.at = Date.now() - 40;
    r.recorded = r.at + 3;
    rateSequence += 1;
    var data = JSON.stringify({ rows: [rateRow(r)], removed: [], sent_ms: Date.now() });
    sources.forEach(function (s) { if (isRates(s)) s._deliver(String(rateSequence), data); });
  }

  function FakeEventSource(url) {
    var self = this;
    this.url = String(url);
    this.readyState = 0;
    this._listeners = {};
    sources.push(this);
    setTimeout(function () {
      self.readyState = 1;
      self._emit("open", {});
    }, 300);
  }
  FakeEventSource.prototype.addEventListener = function (type, fn) {
    (this._listeners[type] = this._listeners[type] || []).push(fn);
  };
  FakeEventSource.prototype.removeEventListener = function () {};
  FakeEventSource.prototype.close = function () {
    this.readyState = 2;
    sources = sources.filter(function (s) { return s !== this; }, this);
  };
  FakeEventSource.prototype._emit = function (type, e) {
    (this._listeners[type] || []).forEach(function (fn) { fn(e); });
  };
  FakeEventSource.prototype._deliver = function (id, data) {
    if (this.readyState === 1) this._emit("message", { type: "message", lastEventId: id, data: data });
  };
  window.EventSource = FakeEventSource;
  setInterval(tick, 900);
  setInterval(rateTick, 700);

  function json(body, status) {
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: status || 200, headers: { "Content-Type": "application/json" }
    }));
  }

  window.fetch = function (input, init) {
    var url = new URL(typeof input === "string" ? input : input.url, location.href);
    var path = url.pathname;
    if (/\/gallery\/snapshot\.json$/.test(path)) {
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(json({ sequence: String(sequence), rows: book.map(row) })); }, 250);
      });
    }
    if (/\/gallery\/rates\/live$/.test(path)) {
      return json({ sequence: String(rateSequence), rows: rates.map(rateRow), now_ms: Date.now() });
    }
    if (/\/gallery\/search$/.test(path)) {
      var q = (url.searchParams.get("q") || "").toLowerCase();
      var limit = Number(url.searchParams.get("limit") || 10);
      var results = INSTRUMENTS.filter(function (i) {
        return i.description.toLowerCase().indexOf(q) >= 0 || i.instrument_id.toLowerCase().indexOf(q) >= 0 ||
          i.identifiers.some(function (x) { return x.value.toLowerCase().indexOf(q) >= 0; });
      }).slice(0, limit);
      return json({ results: results });
    }
    return realFetch(input, init);
  };
})();

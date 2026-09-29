/* The gallery's stand-in for a plugin's own server, so the gallery runs from
 * static files. A real plugin page has nothing like this: its server answers
 * these three URLs, as the README describes.
 *
 *   search          GET ?q=&limit=&as_of=  ->  { results: [InstrumentRecord…] }
 *   snapshot.json   GET                    ->  { sequence, rows }
 *   events          text/event-stream      ->  id: <sequence>, data: { rows }
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

  function tick() {
    var p = book[Math.floor(Math.random() * book.length)];
    p.px = Math.max(1, p.px + Math.round((Math.random() - 0.5) * 60));
    sequence += 1;
    if (sequence % 20 === 0) return; // dropped on the way: the page sees a gap
    var data = JSON.stringify({ rows: [row(p)] });
    sources.forEach(function (s) { s._deliver(String(sequence), data); });
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

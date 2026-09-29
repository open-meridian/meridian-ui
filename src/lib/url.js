// A component that reaches the network reaches only the page's own origin:
// the plugin's server, which proxies anything further (decisions/021: a
// plugin's page has its own origin and never reaches the bus). A URL on any
// other origin is refused, not fetched.

/** The URL resolved against the document, or throw if it leaves the page's origin. */
export function sameOrigin(url, doc = globalThis.document) {
  const base = doc && doc.baseURI ? doc.baseURI : globalThis.location && globalThis.location.href;
  const resolved = new URL(url, base);
  const here = new URL(base);
  if (resolved.origin !== here.origin) {
    throw new Error(`${resolved.origin} is not this page's origin (${here.origin}); the kit reaches only the plugin's own server`);
  }
  return resolved;
}

// Data a page declares in its HTML, for a component to read without the page
// writing any script (meridian-design decisions/025): a child
//
//   <script type="application/json">{ … }</script>
//
// inside the element. A page in any language writes the tag and its JSON; the
// component reads it once, when it is first drawn.
//
// The kit's components load as a module the browser may run before the rest
// of the document is parsed, so an element can be upgraded before its
// children exist. `whenParsed` waits for them.

/** Call `then` once the document is parsed, so the element's children are there. */
export function whenParsed(then) {
  if (document.readyState !== "loading") {
    then();
    return;
  }
  document.addEventListener("DOMContentLoaded", () => then(), { once: true });
}

/** The JSON declared in `element`'s own `<script type="application/json">`
 * child, or null when it has none. JSON that does not parse is reported with
 * an `om-error` event and read as none. */
export function declaredJson(element) {
  const script = [...element.children].find(
    (c) => c.localName === "script" && (c.getAttribute("type") || "").trim().toLowerCase() === "application/json",
  );
  if (!script) return null;
  try {
    const data = JSON.parse(script.textContent);
    return data && typeof data === "object" ? data : null;
  } catch (e) {
    element.dispatchEvent(
      new CustomEvent("om-error", { bubbles: true, detail: { error: `the declared JSON does not parse: ${e.message}` } }),
    );
    return null;
  }
}

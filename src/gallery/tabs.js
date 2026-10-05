// The gallery's own: a page's sections as tabs, so each page fits one screen
// (meridian-design tasks/design/every-page-fits-one-screen.md). A
// <nav class="tabs" data-sections> holds a tab per section, each a link to
// `#<the section's id>`; the section the address names is shown and the rest
// hidden, the first when it names none. A link, so each section opens
// directly, and tools/fit.mjs holds each to the screen by its address.
// Without script every section shows, one under another.

function show() {
  for (const nav of document.querySelectorAll("nav.tabs[data-sections]")) {
    const tabs = [...nav.querySelectorAll("a.tab[href^='#']")];
    const ids = tabs.map((a) => a.getAttribute("href").slice(1));
    const asked = decodeURIComponent(location.hash.slice(1));
    const want = ids.includes(asked) ? asked : ids[0];
    for (const a of tabs) {
      const on = a.getAttribute("href").slice(1) === want;
      a.classList.toggle("on", on);
      if (on) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    for (const id of ids) {
      const section = document.getElementById(id);
      if (section) section.hidden = id !== want;
    }
  }
  // A section shown is laid out afresh: a grid or a chart drawn while hidden
  // had no width to draw to.
  window.dispatchEvent(new Event("resize"));
}

window.addEventListener("hashchange", show);
show();

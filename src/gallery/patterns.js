// The gallery's own: under each pattern, its markup as this page's source
// writes it (between its two comments), which is the README's; and a form
// shown rather than posted, since here there is no plugin's server.

const said = document.getElementById("said");
document.addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.target;
  const fields = [...new FormData(form)].map(([name, value]) => `${name}=${value}`).join("&");
  said.hidden = false;
  said.textContent = `The form would post ${fields} to ${form.getAttribute("action")}.`;
});

const source = await (await fetch(location.pathname)).text();
const blocks = new Map(
  [...source.matchAll(/<!-- pattern: ([a-z-]+) -->\n([\s\S]*?)\n<!-- \/pattern -->/g)].map((m) => [m[1], m[2]]),
);
for (const shown of document.querySelectorAll("details.markup[data-markup]")) {
  const block = blocks.get(shown.dataset.markup);
  if (block === undefined) continue;
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = block;
  pre.append(code);
  shown.append(pre);
}

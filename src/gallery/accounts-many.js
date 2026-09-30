// The gallery's own: 2,000 invented external accounts and 1,500 of the
// deployment's, set as the map's data; and, with no server here, a link
// shown rather than sent, as a page sending the link itself would do.

import { manyAccounts } from "./many-accounts.js";

await customElements.whenDefined("om-account-map");
const map = document.getElementById("map");
const said = document.getElementById("said");
const data = manyAccounts({ externals: 2000, accounts: 1500 });
map.data = data;
const suggested = map.suggestions.length;
document.getElementById("summary").append(
  ` ${data.links.length.toLocaleString("en-US")} linked, ${(data.external_accounts.length - data.links.length).toLocaleString("en-US")} not linked, ${suggested.toLocaleString("en-US")} with a suggestion.`,
);

map.addEventListener("om-link", (event) => {
  event.preventDefault();
  const { form, pairs, ...fields } = event.detail;
  said.className = "notice info";
  said.textContent = pairs
    ? `om-link: ${fields.intent}, ${pairs.length} pairs (the first: ${JSON.stringify(pairs[0])}); the form would post to ${form.getAttribute("action")}.`
    : `om-link: ${JSON.stringify(fields)}; the form would post to ${form.getAttribute("action")}.`;
  said.scrollIntoView({ block: "nearest" });
});

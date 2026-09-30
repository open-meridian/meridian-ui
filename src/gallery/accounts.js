// The gallery's own: a plugin's page would let om-link's form post to its
// server. Here there is no server, so the link is shown rather than sent,
// as a page sending the link itself would do.

const said = document.getElementById("said");
document.getElementById("map").addEventListener("om-link", (event) => {
  event.preventDefault();
  const { form, ...fields } = event.detail;
  said.className = "notice info";
  said.textContent = `om-link: ${JSON.stringify(fields)}; the form would post to ${form.getAttribute("action")}.`;
});

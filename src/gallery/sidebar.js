// The gallery's own: the sidebar page's heading names the item the sidebar
// marks current, so a click (or a hash typed) shows the mark following.

const sidebar = document.querySelector("om-sidebar");
const where = document.getElementById("where");

function say() {
  const now = sidebar.currentItem;
  where.textContent = now ? now.label : "Settings";
}

await customElements.whenDefined("om-sidebar");
await new Promise((ok) => requestAnimationFrame(() => ok()));
say();
window.addEventListener("hashchange", () => requestAnimationFrame(say));

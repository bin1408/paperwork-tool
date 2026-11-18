const toolNav = document.querySelector(".tool-nav");
const toolMenuToggle = document.querySelector("#tool-menu-toggle");
const toolMenuPanel = document.querySelector("#tool-menu-panel");

if (toolNav && toolMenuToggle && toolMenuPanel) {
  toolMenuToggle.addEventListener("click", () => {
    setToolMenuOpen(toolMenuPanel.hidden);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!toolNav.contains(event.target)) setToolMenuOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !toolMenuPanel.hidden) {
      setToolMenuOpen(false);
      toolMenuToggle.focus();
    }
  });

  toolMenuPanel.addEventListener("click", (event) => {
    if (event.target.closest("a")) setToolMenuOpen(false);
  });

  function setToolMenuOpen(open) {
    toolMenuPanel.hidden = !open;
    toolMenuToggle.setAttribute("aria-expanded", String(open));
    toolNav.classList.toggle("is-open", open);
    toolMenuToggle.setAttribute(
      "aria-label",
      open ? "Đóng danh sách công cụ" : "Mở danh sách công cụ",
    );
  }
}

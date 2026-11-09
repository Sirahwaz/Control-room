(() => {
  const tabs = Array.from(document.querySelectorAll("[data-tab-target]"));
  const panels = Array.from(document.querySelectorAll("[data-panel]"));

  function activatePanel(target, focus = false) {
    for (const tab of tabs) {
      const selected = tab.dataset.tabTarget === target;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.panel !== target;
    }
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activatePanel(tab.dataset.tabTarget));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === "ArrowLeft") next = (index + 1) % tabs.length;
      if (event.key === "ArrowRight") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      activatePanel(tabs[next].dataset.tabTarget, true);
    });
  });

  const themeToggle = document.querySelector("[data-theme-toggle]");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      document.documentElement.classList.toggle("light");
    });
  }

  activatePanel("overview");
})();

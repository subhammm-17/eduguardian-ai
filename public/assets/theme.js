// Switches between the dark colours (the original look) and the bright colours.
// The choice is remembered in this browser. Dark stays the default.
(function () {
  const KEY = "eduguardian_theme";
  const DARK_BG = "#241812";
  const LIGHT_BG = "#fbf6ec";
  const root = document.documentElement;

  function saved() {
    try { return localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch (e) { return "dark"; }
  }

  function apply(theme) {
    if (theme === "light") root.setAttribute("data-theme", "light");
    else root.removeAttribute("data-theme");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? LIGHT_BG : DARK_BG);
  }

  // Runs in <head>, before the page is drawn, so there is no flash of the wrong colours
  apply(saved());

  const SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>';

  function addButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle";
    const update = () => {
      const light = saved() === "light";
      // Shows the version you will switch TO
      btn.innerHTML = light ? MOON : SUN;
      btn.setAttribute("aria-label", light ? "Switch to dark colours" : "Switch to bright colours");
      btn.title = btn.getAttribute("aria-label");
    };
    btn.addEventListener("click", () => {
      const next = saved() === "light" ? "dark" : "light";
      try { localStorage.setItem(KEY, next); } catch (e) {}
      apply(next);
      update();
    });
    update();

    // Workspace top bar, then the home page header; otherwise float top-right (sign-in page)
    const spot = document.querySelector(".topbar-controls") || document.querySelector(".site-header-actions");
    if (spot) spot.prepend(btn);
    else { btn.classList.add("theme-toggle-floating"); document.body.appendChild(btn); }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addButton);
  else addButton();
})();

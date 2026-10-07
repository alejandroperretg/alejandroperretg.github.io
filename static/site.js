// Theme toggle and gentle reveal on scroll. The page works fully without this file.
(function () {
  var root = document.documentElement;
  var dark = window.matchMedia("(prefers-color-scheme: dark)");

  function current() {
    return root.dataset.theme || (dark.matches ? "dark" : "light");
  }

  function label(btn) {
    var isDark = current() === "dark";
    btn.setAttribute("aria-label", isDark ? btn.dataset.labelLight : btn.dataset.labelDark);
    btn.setAttribute("aria-pressed", String(isDark));
  }

  document.querySelectorAll(".theme").forEach(function (btn) {
    label(btn);
    btn.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try { localStorage.setItem("theme", next); } catch (e) {}
      label(btn);
    });
    dark.addEventListener("change", function () { label(btn); });
  });

  var items = document.querySelectorAll(".reveal");
  if (!("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { rootMargin: "0px 0px -8% 0px" });
  items.forEach(function (el) { io.observe(el); });
})();

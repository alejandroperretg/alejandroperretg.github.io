// Dimension line under the name: measures the rendered width of the name and labels it in mm (CSS px at 96 dpi).
(function () {
  const name = document.querySelector(".name-text");
  const dim = document.querySelector(".dim");
  if (name && dim) {
    const label = dim.querySelector("b");
    const measure = () => {
      const w = name.getBoundingClientRect().width;
      dim.style.setProperty("--dim-w", w + "px");
      label.textContent = (w * 25.4 / 96).toFixed(1) + " mm";
    };
    measure();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    new ResizeObserver(measure).observe(name);
  }

  // Copy-to-clipboard buttons, with a fallback that selects the text
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const text = btn.dataset.copy;
      const done = () => { btn.textContent = "copied"; setTimeout(() => { btn.textContent = "copy"; }, 1600); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => select(btn));
      else select(btn);
    });
  });
  function select(btn) {
    const target = btn.previousElementSibling;
    if (!target) return;
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
})();

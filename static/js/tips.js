// Readouts for chart marks that carry a data-tip attribute: hover with a mouse, tap on a touch
// screen. The nearest mark within a short distance wins, so small dots are easy to hit.

const tip = document.createElement("div");
tip.className = "tip";
tip.setAttribute("role", "status");
tip.hidden = true;
document.body.append(tip);

let current = null;

function nearest(svg, x, y) {
  let best = null;
  let bestD = 26;
  let bestArea = Infinity;
  for (const el of svg.querySelectorAll("[data-tip]")) {
    const r = el.getBoundingClientRect();
    const dx = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
    const dy = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
    const d = Math.hypot(dx, dy);
    const area = r.width * r.height;
    if (d < bestD || (d === bestD && area < bestArea)) {
      bestD = d;
      bestArea = area;
      best = el;
    }
  }
  return best;
}

function show(el, x, y) {
  if (current !== el) {
    current?.classList.remove("on");
    el.classList.add("on");
    current = el;
    tip.textContent = el.dataset.tip;
  }
  tip.hidden = false;
  const w = tip.offsetWidth;
  const h = tip.offsetHeight;
  const left = Math.min(Math.max(8, x + 14), window.innerWidth - w - 8);
  const top = y - h - 14 < 8 ? y + 18 : y - h - 14;
  tip.style.transform = `translate(${left}px, ${top}px)`;
}

function hide() {
  current?.classList.remove("on");
  current = null;
  tip.hidden = true;
}

// Delegated listeners, so charts drawn later by scripts get readouts too.
const chartAt = (target) => {
  const svg = target?.closest?.("svg");
  return svg && !svg.closest(".thumb") && svg.querySelector("[data-tip]") ? svg : null;
};
const handle = (e) => {
  const svg = chartAt(e.target);
  const el = svg && nearest(svg, e.clientX, e.clientY);
  if (el) show(el, e.clientX, e.clientY);
  else hide();
};
document.addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse" && (current || chartAt(e.target))) handle(e);
});
document.addEventListener("pointerdown", handle);
window.addEventListener("scroll", () => current && hide(), { passive: true });

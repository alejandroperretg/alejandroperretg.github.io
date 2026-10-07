// A small reward for the clicks that matter (CV, projects): a burst of ink and bronze sparks
// that fall under gravity. Same-tab links wait a moment so the burst is seen; new tabs,
// modified clicks and in-page anchors are never delayed. Nothing happens with reduced motion.

import { cssVar, fitCanvas, reducedMotion } from "./util.js";

const DELAY = 380; // ms
let canvas = null;
let ctx = null;
let sparks = [];
let running = false;

function ensureCanvas() {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.className = "reward-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.append(canvas);
  ctx = fitCanvas(canvas, innerWidth, innerHeight);
  addEventListener("resize", () => (ctx = fitCanvas(canvas, innerWidth, innerHeight)));
}

function burst(x, y) {
  ensureCanvas();
  const ink = cssVar("--ink");
  const accent = cssVar("--accent");
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * 2 * Math.PI;
    const s = 180 + Math.random() * 260;
    sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0, max: 0.55 + Math.random() * 0.35, color: i % 3 ? accent : ink, r: 1.5 + Math.random() * 2 });
  }
  if (!running) {
    running = true;
    let last = performance.now();
    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 0.033);
      last = now;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      sparks = sparks.filter((s) => (s.life += dt) < s.max);
      for (const s of sparks) {
        s.vy += 900 * dt;
        s.vx *= 1 - 2 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        ctx.globalAlpha = 1 - s.life / s.max;
        ctx.fillStyle = s.color;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 2 * Math.PI);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (sparks.length) requestAnimationFrame(loop);
      else running = false;
    };
    requestAnimationFrame(loop);
  }
}

document.addEventListener("click", (e) => {
  const link = e.target.closest?.("[data-reward]");
  if (!link || reducedMotion.matches) return;
  // keyboard activation reports (0, 0): burst from the element's centre instead
  let { clientX: x, clientY: y } = e;
  if (!x && !y) {
    const r = link.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top + r.height / 2;
  }
  burst(x, y);
  const href = link.getAttribute("href") || "";
  const samePage = link.pathname === location.pathname && link.hash;
  if (href.startsWith("#") || samePage || link.target === "_blank" || link.hasAttribute("download")) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
  e.preventDefault();
  setTimeout(() => {
    location.href = link.href;
  }, DELAY);
});

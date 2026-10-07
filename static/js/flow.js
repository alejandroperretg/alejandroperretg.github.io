// Contact section: particles carried by inviscid potential flow past a cylinder.
// The cylinder follows the pointer (or finger); without one it drifts slowly on its own.
// Velocity around a cylinder of radius R in a uniform stream U, relative to its centre:
//   u = U (1 - R^2 (x^2 - y^2) / r^4),   v = -2 U R^2 x y / r^4

import { animate, cssVar, fitCanvas, onThemeChange, reducedMotion } from "./util.js";

const host = document.querySelector("[data-flow]");
if (host) start(host);

function start(host) {
  const canvas = document.createElement("canvas");
  canvas.className = "flow-canvas";
  canvas.setAttribute("aria-hidden", "true");
  host.prepend(canvas);

  let w = 0;
  let h = 0;
  let ctx = null;
  let colors = {};
  let parts = [];
  const U = 46; // stream speed, px/s
  const cyl = { x: 0, y: 0, tx: 0, ty: 0, r: 70, free: true, t: 0 };

  const readColors = () => {
    colors = { ink: cssVar("--muted"), accent: cssVar("--accent"), line: cssVar("--line") };
  };

  const spawn = (atLeft) => ({
    x: atLeft ? -10 - Math.random() * 40 : Math.random() * w,
    y: Math.random() * h,
    hot: Math.random() < 0.12,
    px: 0,
    py: 0,
  });

  function setup() {
    w = host.clientWidth;
    h = host.clientHeight;
    ctx = fitCanvas(canvas, w, h);
    cyl.r = Math.max(42, Math.min(80, w * 0.06));
    const count = Math.round(Math.min(220, (w * h) / 5200));
    parts = Array.from({ length: count }, () => spawn(false));
    for (const p of parts) {
      p.px = p.x;
      p.py = p.y;
    }
    if (cyl.free) {
      cyl.x = cyl.tx = w * 0.72;
      cyl.y = cyl.ty = h * 0.42;
    }
    // let the particles settle into the flow, then draw one frame (all that reduced motion shows)
    for (let i = 0; i < 90; i++) step(1 / 30);
  }

  function velocity(x, y) {
    const dx = x - cyl.x;
    const dy = y - cyl.y;
    const r2 = dx * dx + dy * dy;
    const R2 = cyl.r * cyl.r;
    if (r2 < R2) return [U * 2 * Math.sign(dx || 1), U * Math.sign(dy || 1)]; // pushed out of the body
    const r4 = r2 * r2;
    return [U * (1 - (R2 * (dx * dx - dy * dy)) / r4), (-2 * U * R2 * dx * dy) / r4];
  }

  function step(dt) {
    cyl.t += dt;
    if (cyl.free) {
      cyl.tx = w * (0.7 + 0.08 * Math.sin(cyl.t * 0.23));
      cyl.ty = h * (0.42 + 0.12 * Math.sin(cyl.t * 0.17 + 1));
    }
    cyl.x += (cyl.tx - cyl.x) * Math.min(1, dt * 4);
    cyl.y += (cyl.ty - cyl.y) * Math.min(1, dt * 4);

    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    for (const hot of [false, true]) {
      ctx.strokeStyle = hot ? colors.accent : colors.ink;
      ctx.globalAlpha = hot ? 0.85 : 0.6;
      ctx.beginPath();
      for (const p of parts) {
        if (p.hot !== hot) continue;
        const [u, v] = velocity(p.x, p.y);
        p.px = p.x;
        p.py = p.y;
        p.x += u * dt;
        p.y += v * dt;
        if (p.x > w + 10 || p.y < -20 || p.y > h + 20) {
          Object.assign(p, spawn(true));
          p.px = p.x;
          p.py = p.y;
          continue;
        }
        // short streak along the velocity, so the eye reads the streamlines
        ctx.moveTo(p.x - u * 0.16, p.y - v * 0.16);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.line;
    ctx.beginPath();
    ctx.arc(cyl.x, cyl.y, cyl.r, 0, 2 * Math.PI);
    ctx.stroke();
  }

  host.addEventListener("pointermove", (e) => {
    const rect = host.getBoundingClientRect();
    cyl.free = false;
    cyl.tx = e.clientX - rect.left;
    cyl.ty = e.clientY - rect.top;
  });
  host.addEventListener("pointerleave", () => {
    cyl.free = true;
  });

  readColors();
  setup();
  new ResizeObserver(() => setup()).observe(host);
  onThemeChange(() => {
    readColors();
    step(0);
  });
  if (!reducedMotion.matches) animate(canvas, step);
}

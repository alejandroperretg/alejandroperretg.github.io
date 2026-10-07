// Remora page: a drone that follows a person. Each axis is a second-order system,
//   x'' = w^2 (target - x) - 2 z w x'
// with natural frequency w (response) and damping ratio z. The target sits a little behind
// and above the person. Move the pointer (or finger) to be the person; otherwise a virtual
// runner jogs around the field.

import { animate, cssVar, fitCanvas, fmtNumber, onThemeChange, reducedMotion } from "./util.js";

const root = document.querySelector("[data-follow]");
if (root) start(root);

function start(root) {
  const canvas = root.querySelector("canvas");
  const wInput = root.querySelector("input[name=response]");
  const zInput = root.querySelector("input[name=damping]");
  const verdict = root.querySelector("[data-verdict]");
  const texts = JSON.parse(root.dataset.texts);
  let w = 0;
  let h = 0;
  let ctx = null;
  let colors = {};
  let t = 0;
  let pointer = null;
  let lastPointer = -10;
  const person = { x: 0, y: 0 };
  const drone = { x: 0, y: 0, vx: 0, vy: 0 };
  const trail = [];

  const readColors = () => {
    colors = { ink: cssVar("--ink"), muted: cssVar("--muted"), accent: cssVar("--accent"), line: cssVar("--line") };
  };

  function setup() {
    w = Math.floor(canvas.parentElement.clientWidth);
    h = Math.round(Math.max(260, Math.min(520, w * 0.5)));
    ctx = fitCanvas(canvas, w, h);
    if (!drone.x) {
      runner(0);
      drone.x = person.x;
      drone.y = person.y - 40;
    }
    draw();
  }

  function runner(time) {
    // a jogging loop: a slow Lissajous figure across the field
    person.x = w * (0.5 + 0.36 * Math.sin(time * 0.45));
    person.y = h * (0.55 + 0.28 * Math.sin(time * 0.9 + 0.6));
  }

  function params() {
    return { omega: Number(wInput.value), zeta: Number(zInput.value) };
  }

  function describe() {
    const { omega, zeta } = params();
    let text = zeta < 0.95 ? texts.under : zeta <= 1.05 ? texts.critical : texts.over;
    // 2% settling time: set by the decay rate, z w when underdamped, the slow pole otherwise
    const rate = zeta < 1 ? zeta * omega : omega * (zeta - Math.sqrt(zeta * zeta - 1));
    const settle = 4 / rate;
    text += ` · ${texts.settle} ≈ ${fmtNumber(settle, 1)} s`;
    verdict.textContent = text;
    root.querySelector('[data-val="response"]').textContent = `${fmtNumber(omega, 1)} rad/s`;
    root.querySelector('[data-val="damping"]').textContent = fmtNumber(zeta, 2);
  }

  function step(dt) {
    t += dt;
    if (pointer && t - lastPointer < 2.5) {
      person.x += (pointer.x - person.x) * Math.min(1, dt * 12);
      person.y += (pointer.y - person.y) * Math.min(1, dt * 12);
    } else {
      runner(t);
    }
    const { omega, zeta } = params();
    const tx = person.x;
    const ty = person.y - 46;
    // small sub-steps keep the integration stable at high response
    const n = 4;
    const h2 = dt / n;
    for (let i = 0; i < n; i++) {
      drone.vx += (omega * omega * (tx - drone.x) - 2 * zeta * omega * drone.vx) * h2;
      drone.vy += (omega * omega * (ty - drone.y) - 2 * zeta * omega * drone.vy) * h2;
      drone.x += drone.vx * h2;
      drone.y += drone.vy * h2;
    }
    trail.push([drone.x, drone.y]);
    if (trail.length > 70) trail.shift();
    draw();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    // faint grid, like a test field
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 40; x < w; x += 40) {
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
    }
    for (let y = 40; y < h; y += 40) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
    }
    ctx.stroke();
    // trail
    ctx.strokeStyle = colors.accent;
    for (let i = 1; i < trail.length; i++) {
      ctx.globalAlpha = (i / trail.length) * 0.6;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1][0], trail[i - 1][1]);
      ctx.lineTo(trail[i][0], trail[i][1]);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // tether from target point to person
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = colors.muted;
    ctx.beginPath();
    ctx.moveTo(person.x, person.y);
    ctx.lineTo(drone.x, drone.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // person
    ctx.fillStyle = colors.ink;
    ctx.beginPath();
    ctx.arc(person.x, person.y, 6, 0, 2 * Math.PI);
    ctx.fill();
    // drone: four rotors on an X frame
    const r = 13;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(drone.x - r, drone.y - r);
    ctx.lineTo(drone.x + r, drone.y + r);
    ctx.moveTo(drone.x + r, drone.y - r);
    ctx.lineTo(drone.x - r, drone.y + r);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    for (const [dx, dy] of [[-r, -r], [r, -r], [r, r], [-r, r]]) {
      ctx.beginPath();
      ctx.arc(drone.x + dx, drone.y + dy, 6.5, 0, 2 * Math.PI);
      ctx.stroke();
    }
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(drone.x, drone.y, 3.5, 0, 2 * Math.PI);
    ctx.fill();
  }

  const move = (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    lastPointer = t;
    if (reducedMotion.matches) {
      person.x = pointer.x;
      person.y = pointer.y;
      drone.x = person.x;
      drone.y = person.y - 46;
      draw();
    }
  };
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerdown", move);
  for (const input of [wInput, zInput]) input.addEventListener("input", describe);

  readColors();
  setup();
  describe();
  new ResizeObserver(() => setup()).observe(canvas.parentElement);
  onThemeChange(() => {
    readColors();
    draw();
  });
  if (!reducedMotion.matches) animate(canvas, step);
}

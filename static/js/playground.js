// Home page: the letters of the name are loose. Grab one and throw it, or use it as a bat to
// knock the others; thrown letters collide, spin and orbit a small black hole. Letters that
// cross the innermost stable orbit spiral in and are swallowed. Tapping empty space launches
// a planet. After a few quiet seconds everything returns and the name is whole again.
//
// Physics, in hero coordinates (px, s):
//   gravity   Paczynski-Wiita potential  phi = -G / (r - rs)   (pseudo-Newtonian black hole):
//             a = -G / (r - rs)^2 radially; circular speed v_c = sqrt(G r) / (r - rs);
//             circular orbits are unstable inside r_isco = 3 rs, as for a real black hole
//   assist    outside r_isco, radial speed is damped and tangential speed relaxes toward v_c
//             (drag in a disk), so most throws settle into a clean orbit; bodies beyond the
//             largest orbit that fits in the hero are pulled gently inward
//   contacts  circles sized from each glyph, mass ~ r^2, restitution E, friction MU turns
//             glancing hits into spin; a held letter is kinematic (infinite mass)
//   return    critically damped spring toward home
// Semi-implicit Euler with sub-steps.

import { animate, cssVar, fitCanvas, reducedMotion } from "./util.js";

const G = 4.2e6;
const E = 0.75;
const MU = 0.35;
const K_HOME = 60;
const IDLE_RETURN = 12; // s of real time
const ASSIST_R = 0.7; // weak enough that about a quarter of throws spiral in
const ASSIST_T = 0.5;
const TIME_SCALE = 0.6; // the simulation runs at 60% speed, so the motion is easy to follow
const THROW_GAIN = 0.4;
const THROW_MAX = 600;
const MAX_PLANETS = 12;
const PLANET_LIFE = 20;
const A_MAX = 30000; // px/s^2, keeps the integration stable right at the horizon

function start(hero) {
  const name = hero.querySelector(".name");
  const hint = hero.querySelector(".hint");
  const canvas = document.createElement("canvas");
  canvas.className = "orbit-canvas";
  canvas.setAttribute("aria-hidden", "true");
  hero.prepend(canvas);

  // Wrap every character in its own span; the h1 keeps its accessible name.
  name.setAttribute("aria-label", [...name.querySelectorAll(":scope > span")].map((s) => s.textContent.trim()).join(" "));
  const letters = [];
  for (const line of name.querySelectorAll(":scope > span")) {
    const text = line.textContent;
    line.textContent = "";
    for (const ch of text) {
      const el = document.createElement("span");
      el.className = "ltr";
      el.textContent = ch;
      el.setAttribute("aria-hidden", "true");
      line.append(el);
      letters.push({ el, hx: 0, hy: 0, x: 0, y: 0, vx: 0, vy: 0, a: 0, va: 0, r: 10, m: 1, squash: 0, state: "home", trail: [] });
    }
  }

  let ctx = null;
  let w = 0;
  let h = 0;
  let colors = {};
  const hole = { x: 0, y: 0, rs: 14, rMax: 100, flare: 0 };
  let planets = [];
  let quiet = 0;
  let clock = 0;
  let touched = false;
  let wobbleClock = 0;
  let held = null;

  const readColors = () => {
    colors = { ink: cssVar("--ink"), muted: cssVar("--muted"), accent: cssVar("--accent") };
  };

  // Home positions, glyph sizes and the black hole's place, measured with every letter at home.
  function measure() {
    const box = hero.getBoundingClientRect();
    w = box.width;
    h = box.height;
    ctx = fitCanvas(canvas, w, h);
    for (const L of letters) {
      L.el.style.transform = "";
      L.el.style.opacity = "";
    }
    for (const L of letters) {
      const r = L.el.getBoundingClientRect();
      L.hx = r.left - box.left + r.width / 2;
      L.hy = r.top - box.top + r.height / 2;
      L.r = Math.max(6, 0.5 * Math.min(r.width * 0.92, r.height * 0.62));
      L.m = L.r * L.r;
      Object.assign(L, { x: L.hx, y: L.hy, vx: 0, vy: 0, a: 0, va: 0, squash: 0, state: "home", trail: [] });
    }
    const first = [...name.querySelector(":scope > span").querySelectorAll(".ltr")].map((el) => el.getBoundingClientRect());
    const lineRight = Math.max(...first.map((r) => r.right)) - box.left;
    const lineH = Math.max(...first.map((r) => r.height));
    hole.x = Math.min(w - 80, (lineRight + w) / 2);
    hole.y = (Math.min(...first.map((r) => r.top)) + Math.max(...first.map((r) => r.bottom))) / 2 - box.top;
    hole.rs = Math.max(9, Math.min(16, lineH * 0.09));
    hole.rMax = Math.max(4 * hole.rs, Math.min(hole.x, w - hole.x, hole.y, h - hole.y) - 24);
    planets = [];
  }

  const active = () => held || letters.some((L) => L.state !== "home") || planets.length || hole.flare > 0.01;

  function wake() {
    quiet = 0;
    if (!touched) {
      touched = true;
      hint?.classList.add("done");
    }
  }

  // Gravity plus orbit assist for a body at (px, py) moving with (vx, vy).
  function accel(px, py, vx, vy) {
    const dx = px - hole.x;
    const dy = py - hole.y;
    const r = Math.max(hole.rs * 1.01, Math.hypot(dx, dy));
    const rx = dx / r;
    const ry = dy / r;
    let ar = -G / ((r - hole.rs) * (r - hole.rs));
    let at = 0;
    if (r > 3 * hole.rs) {
      const vr = vx * rx + vy * ry;
      const vt = -vx * ry + vy * rx;
      const vc = Math.sqrt(G * r) / (r - hole.rs);
      ar -= ASSIST_R * vr;
      at = ASSIST_T * ((vt >= 0 ? 1 : -1) * vc - vt);
      if (r > hole.rMax) ar -= 2.5 * (r - hole.rMax);
    }
    let ax = ar * rx - at * ry;
    let ay = ar * ry + at * rx;
    const mag = Math.hypot(ax, ay);
    if (mag > A_MAX) {
      ax *= A_MAX / mag;
      ay *= A_MAX / mag;
    }
    return [ax, ay];
  }

  function step(realDt) {
    clock += realDt;
    const dt = realDt * TIME_SCALE;
    hole.flare = Math.max(0, hole.flare - dt * 1.5);
    if (!active()) {
      draw();
      idleWobble(realDt);
      return;
    }
    quiet += realDt;
    if (quiet > IDLE_RETURN) {
      for (const L of letters) {
        if (L.state === "free") L.state = "returning";
        if (L.state === "gone") comeBack(L);
      }
    }

    const n = 6;
    const hdt = dt / n;
    for (let s = 0; s < n; s++) {
      for (const L of letters) {
        if (L === held || L.state === "home" || L.state === "gone") continue;
        if (L.state === "free") {
          const [ax, ay] = accel(L.x, L.y, L.vx, L.vy);
          L.vx += ax * hdt;
          L.vy += ay * hdt;
          L.va *= 1 - 0.6 * hdt;
        } else {
          const c = 2 * Math.sqrt(K_HOME);
          L.vx += (K_HOME * (L.hx - L.x) - c * L.vx) * hdt;
          L.vy += (K_HOME * (L.hy - L.y) - c * L.vy) * hdt;
          L.va += (K_HOME * -L.a - c * L.va) * hdt;
        }
        L.x += L.vx * hdt;
        L.y += L.vy * hdt;
        L.a += L.va * hdt;
        if (L.state === "free") {
          walls(L);
          swallow(L);
        }
      }
      collide();
      for (const p of planets) {
        if (p.gone) continue;
        const [ax, ay] = accel(p.x, p.y, p.vx, p.vy);
        p.vx += ax * hdt;
        p.vy += ay * hdt;
        p.x += p.vx * hdt;
        p.y += p.vy * hdt;
        if (Math.hypot(p.x - hole.x, p.y - hole.y) < hole.rs * 1.05) {
          p.gone = true;
          hole.flare = Math.min(1, hole.flare + 0.5);
        }
      }
    }

    for (const L of letters) {
      L.squash *= Math.exp(-12 * dt);
      if (L.state === "returning" && Math.hypot(L.x - L.hx, L.y - L.hy) < 0.6 && Math.hypot(L.vx, L.vy) < 8) {
        Object.assign(L, { x: L.hx, y: L.hy, vx: 0, vy: 0, a: 0, va: 0, squash: 0, state: "home", trail: [] });
        L.el.style.transform = "";
      } else if (L.state === "free" || L.state === "returning") {
        render(L);
        if (L.state === "free") {
          L.trail.push([L.x, L.y]);
          if (L.trail.length > 80) L.trail.shift();
        } else if (L.trail.length) L.trail.shift();
      }
    }
    for (const p of planets) {
      p.life += dt;
      if (!p.gone) p.trail.push([p.x, p.y]);
      if (p.trail.length > 110 || (p.gone && p.trail.length)) p.trail.shift();
    }
    planets = planets.filter((p) => p.life < PLANET_LIFE && (!p.gone || p.trail.length));
    draw();
  }

  // Near the horizon a letter is stretched along the radius and fades: spaghettification.
  function render(L) {
    const dx = L.x - L.hx;
    const dy = L.y - L.hy;
    const d = Math.hypot(L.x - hole.x, L.y - hole.y);
    const near = L.state === "free" ? Math.max(0, Math.min(1, (3 * hole.rs - d) / (2 * hole.rs))) : 0;
    let tf = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    if (near > 0) {
      const ang = Math.atan2(L.y - hole.y, L.x - hole.x);
      tf += ` rotate(${ang.toFixed(3)}rad) scale(${(1 + 1.6 * near).toFixed(3)}, ${(1 - 0.8 * near).toFixed(3)}) rotate(${(-ang).toFixed(3)}rad)`;
    }
    tf += ` rotate(${L.a.toFixed(3)}rad)`;
    if (L.squash > 0.01) tf += ` scale(${(1 + L.squash).toFixed(3)}, ${(1 - L.squash).toFixed(3)})`;
    L.el.style.transform = tf;
    L.el.style.opacity = near > 0 ? (1 - 0.85 * near).toFixed(2) : "";
  }

  function swallow(L) {
    if (Math.hypot(L.x - hole.x, L.y - hole.y) > hole.rs * 1.1) return;
    L.state = "gone";
    L.el.style.opacity = "0";
    L.trail = [];
    hole.flare = 1;
  }

  // A swallowed letter pops back into its place.
  function comeBack(L) {
    Object.assign(L, { x: L.hx, y: L.hy, vx: 0, vy: 0, a: 0, va: 0, squash: 0, state: "home", trail: [] });
    L.el.style.transform = "";
    L.el.style.opacity = "";
    L.el.animate([{ transform: "scale(0)", opacity: 0 }, { transform: "scale(1.18)", opacity: 1, offset: 0.7 }, { transform: "scale(1)" }], {
      duration: 520,
      easing: "cubic-bezier(.2,.9,.3,1)",
      delay: Math.random() * 250,
      fill: "backwards",
    });
  }

  function walls(L) {
    if (L.x < L.r) [L.x, L.vx] = [L.r, Math.abs(L.vx) * E];
    if (L.x > w - L.r) [L.x, L.vx] = [w - L.r, -Math.abs(L.vx) * E];
    if (L.y < L.r) [L.y, L.vy] = [L.r, Math.abs(L.vy) * E];
    if (L.y > h - L.r) [L.y, L.vy] = [h - L.r, -Math.abs(L.vy) * E];
  }

  // Circle contacts with mass ~ r^2, restitution and friction. A held letter is kinematic.
  // A resting letter only takes part when something actually hits it.
  function collide() {
    for (let i = 0; i < letters.length; i++) {
      const A = letters[i];
      if (A.state === "gone" || A.state === "returning") continue;
      for (let j = i + 1; j < letters.length; j++) {
        const B = letters[j];
        if (B.state === "gone" || B.state === "returning") continue;
        if (A.state === "home" && B.state === "home") continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const min = A.r + B.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        const rvx = B.vx - A.vx;
        const rvy = B.vy - A.vy;
        const rel = rvx * nx + rvy * ny;
        const restingInvolved = A.state === "home" || B.state === "home";
        if (rel > (restingInvolved ? -30 : 0)) continue;
        for (const L of [A, B]) if (L.state === "home") L.state = "free";
        const ia = A === held ? 0 : 1 / A.m;
        const ib = B === held ? 0 : 1 / B.m;
        if (ia + ib === 0) continue;
        const jn = (-(1 + E) * rel) / (ia + ib);
        // friction along the contact turns glancing hits into spin
        const tx = -ny;
        const ty = nx;
        const vt = rvx * tx + rvy * ty;
        const jt = Math.max(-MU * jn, Math.min(MU * jn, -vt / (ia + ib)));
        A.vx -= (jn * nx + jt * tx) * ia;
        A.vy -= (jn * ny + jt * ty) * ia;
        B.vx += (jn * nx + jt * tx) * ib;
        B.vy += (jn * ny + jt * ty) * ib;
        A.va -= (2 * jt * ia) / A.r;
        B.va -= (2 * jt * ib) / B.r;
        A.squash = Math.min(0.22, A.squash + jn * ia * 0.0005);
        B.squash = Math.min(0.22, B.squash + jn * ib * 0.0005);
        const share = ia + ib;
        const push = min - d;
        A.x -= nx * push * (ia / share);
        A.y -= ny * push * (ia / share);
        B.x += nx * push * (ib / share);
        B.y += ny * push * (ib / share);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 1.2;
    ctx.lineCap = "round";
    const trail = (pts, color, alpha) => {
      ctx.strokeStyle = color;
      for (let i = 1; i < pts.length; i++) {
        ctx.globalAlpha = (i / pts.length) * alpha;
        ctx.beginPath();
        ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
        ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
    };
    for (const L of letters) if (L.trail.length > 1) trail(L.trail, colors.muted, 0.7);
    for (const p of planets) {
      const fade = Math.min(1, (PLANET_LIFE - p.life) / 3);
      trail(p.trail, p.color, 0.8 * fade);
      if (p.gone) continue;
      ctx.globalAlpha = fade;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
    drawHole();
    ctx.globalAlpha = 1;
  }

  // Black hole: a tilted accretion disk passing behind and in front of a dark horizon,
  // a thin photon ring, and a soft glow that flares when something falls in.
  function drawHole() {
    const { x, y, rs } = hole;
    const glow = 0.5 + 0.5 * Math.sin(clock * 1.6);
    const flare = hole.flare;
    const diskA = rs * 3.4;
    const diskB = rs * 0.95;
    const tilt = -0.18;
    const disk = (from, to) => {
      for (let k = 0; k < 3; k++) {
        ctx.globalAlpha = Math.min(1, (0.55 - k * 0.15) * (0.8 + 0.2 * glow) + 0.3 * flare);
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = rs * (0.55 - k * 0.15);
        ctx.beginPath();
        ctx.ellipse(x, y, diskA * (1 - k * 0.12), diskB * (1 - k * 0.12), tilt, from, to);
        ctx.stroke();
      }
      // a few bright clumps travelling around the disk
      ctx.fillStyle = colors.accent;
      ctx.globalAlpha = 0.9;
      for (let q = 0; q < 5; q++) {
        const th = clock * (1.4 + q * 0.13) + q * 1.3;
        const s = Math.sin(th);
        const front = s >= 0;
        if (front !== (from === 0)) continue;
        const ex = diskA * Math.cos(th);
        const ey = diskB * s;
        ctx.beginPath();
        ctx.arc(x + ex * Math.cos(tilt) - ey * Math.sin(tilt), y + ex * Math.sin(tilt) + ey * Math.cos(tilt), rs * 0.13, 0, 2 * Math.PI);
        ctx.fill();
      }
    };
    // outer glow
    ctx.globalAlpha = 0.08 + 0.05 * glow + 0.25 * flare;
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(x, y, rs * (2.6 + 0.4 * glow + flare), 0, 2 * Math.PI);
    ctx.fill();
    disk(Math.PI, 2 * Math.PI); // far half, behind the hole
    // photon ring and horizon
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 1.6 + 2 * flare;
    ctx.beginPath();
    ctx.arc(x, y, rs * 1.18, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0b0a09";
    ctx.beginPath();
    ctx.arc(x, y, rs, 0, 2 * Math.PI);
    ctx.fill();
    disk(0, Math.PI); // near half, in front of the hole
  }

  // A small nudge now and then, until the visitor has tried it once.
  function idleWobble(dt) {
    if (touched) return;
    wobbleClock += dt;
    if (wobbleClock < 9) return;
    wobbleClock = 0;
    const L = letters[Math.floor(Math.random() * letters.length)];
    L.el.animate(
      [{ transform: "rotate(0)" }, { transform: "rotate(-9deg) translateY(-6px)" }, { transform: "rotate(6deg)" }, { transform: "rotate(0)" }],
      { duration: 700, easing: "ease-out" },
    );
  }

  // ---- input ----
  const local = (e) => {
    const box = hero.getBoundingClientRect();
    return [e.clientX - box.left, e.clientY - box.top];
  };
  let samples = [];
  let grab = [0, 0];

  for (const L of letters) {
    L.el.addEventListener("pointerdown", (e) => {
      if (L.state === "gone") return;
      e.preventDefault();
      wake();
      L.el.setPointerCapture(e.pointerId);
      L.el.classList.add("held");
      held = L;
      L.state = "free";
      const [px, py] = local(e);
      grab = [L.x - px, L.y - py];
      samples = [[px, py, performance.now()]];
      L.vx = L.vy = 0;
    });
    L.el.addEventListener("pointermove", (e) => {
      if (held !== L) return;
      const [px, py] = local(e);
      const now = performance.now();
      const prev = samples[samples.length - 1];
      const dts = Math.max((now - prev[2]) / 1000, 0.008);
      // the held letter moves with the pointer; its velocity is what it hits other letters with
      L.vx = 0.5 * L.vx + 0.5 * ((px - prev[0]) / dts);
      L.vy = 0.5 * L.vy + 0.5 * ((py - prev[1]) / dts);
      L.x = px + grab[0];
      L.y = py + grab[1];
      walls(L);
      samples.push([px, py, now]);
      if (samples.length > 6) samples.shift();
      // resolve hits right away, so a fast swing never passes through a letter between frames
      collide();
      for (const other of letters) if (other.state === "free") render(other);
      wake();
    });
    const release = () => {
      if (held !== L) return;
      held = null;
      L.el.classList.remove("held");
      const now = performance.now();
      const recent = samples.filter((s) => now - s[2] < 100);
      L.vx = L.vy = 0;
      if (recent.length >= 2) {
        const [x0, y0, t0] = recent[0];
        const [x1, y1, t1] = recent[recent.length - 1];
        const dt = Math.max((t1 - t0) / 1000, 0.008);
        const sp = Math.min(THROW_MAX, (THROW_GAIN * Math.hypot(x1 - x0, y1 - y0)) / dt);
        const ang = Math.atan2(y1 - y0, x1 - x0);
        L.vx = sp * Math.cos(ang);
        L.vy = sp * Math.sin(ang);
      }
      L.va = L.vx * 0.004;
      wake();
    };
    L.el.addEventListener("pointerup", release);
    L.el.addEventListener("pointercancel", release);
  }

  // Tap empty space: launch a planet on a circular orbit.
  hero.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".ltr, a, button, p, li, h1 > span")) return;
    wake();
    const [x, y] = local(e);
    const dx = x - hole.x;
    const dy = y - hole.y;
    const r = Math.max(4 * hole.rs, Math.hypot(dx, dy));
    const v = Math.sqrt(G * r) / (r - hole.rs);
    planets.push({ x, y, vx: (-dy / r) * v, vy: (dx / r) * v, life: 0, trail: [], gone: false, color: planets.length % 2 ? colors.ink : colors.accent });
    if (planets.length > MAX_PLANETS) planets.shift();
  });

  readColors();
  document.fonts.ready.then(measure);
  measure();
  name.addEventListener("transitionend", () => !active() && measure());
  new ResizeObserver(() => measure()).observe(hero);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readColors);
  animate(hero, step);
}

const hero = document.querySelector("[data-playground]");
if (hero && !reducedMotion.matches) start(hero);

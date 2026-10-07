// Thesis page: a small Ising lattice and the eigenvalue histogram of its spin matrix
// M = (sigma + sigma^T) / 2, updated live. Eigenvalues are shown as x = lambda / sqrt(L),
// with the sign chosen so that the magnetisation is positive (the thesis' Z2 correction).
// The dashed curve is the Wigner semicircle of radius sqrt(2) for uncorrelated +-1 entries.

import { Ising, T_CRITICAL, symmetricEigenvalues } from "./ising.js";
import { animate, cssVar, fitCanvas, fmtNumber, onThemeChange, reducedMotion } from "./util.js";

const L = 32;
const X0 = -3;
const X1 = 6.5;
const BINS = 38;
const YMAX = 1.6;
const KEEP = 48; // spectra kept in the running histogram

function start(root) {
  const canvas = root.querySelector("canvas");
  const svg = root.querySelector("svg");
  const slider = root.querySelector("input[type=range]");
  const tValue = root.querySelector("[data-t-value]");
  const steps = [...root.querySelectorAll("[data-step]")];
  const notes = [...root.querySelectorAll("[data-note]")];
  const model = new Ising(L);
  let T = T_CRITICAL;
  let spectra = [];
  let frame = 0;
  let ctx = null;
  let size = 0;
  let colors = {};

  // ---- histogram (SVG, styled by the site's chart classes) ----
  const ns = "http://www.w3.org/2000/svg";
  const px0 = 6;
  const px1 = 78;
  const py0 = 34;
  const py1 = 3;
  const sx = (x) => px0 + ((x - X0) / (X1 - X0)) * (px1 - px0);
  const sy = (d) => py0 - ((py0 - py1) * Math.min(d, YMAX)) / YMAX;
  const el = (name, attrs) => {
    const node = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.append(node);
    return node;
  };
  const bars = [];
  const bw = (X1 - X0) / BINS;
  for (let b = 0; b < BINS; b++) {
    bars.push(el("rect", { class: "hist", x: (sx(X0 + b * bw) + 0.1).toFixed(2), width: (sx(X0 + bw) - sx(X0) - 0.2).toFixed(2), y: py0, height: 0 }));
  }
  const R = Math.SQRT2;
  let semi = "";
  for (let i = 0; i <= 60; i++) {
    const x = -R + (2 * R * i) / 60;
    semi += (i ? "L" : "M") + sx(x).toFixed(2) + " " + sy(Math.sqrt(Math.max(R * R - x * x, 0)) / Math.PI).toFixed(2);
  }
  el("path", { class: "dash", d: semi });
  el("path", { class: "ax", d: `M${px0} ${py0}L${px1} ${py0}` });
  for (let x = -2; x <= 4; x += 2) {
    const t = el("text", { class: "tk", x: sx(x).toFixed(2), y: py0 + 3.6, "text-anchor": "middle" });
    t.textContent = String(x).replace("-", "−");
  }
  const axisLabel = el("text", { class: "tk", x: px1, y: py0 + 3.6, "text-anchor": "end" });
  axisLabel.textContent = "λ/√L";
  const marker = el("path", { class: "ln-acc", d: "" });
  const markerText = el("text", { class: "tv", x: 0, y: 5.4, "text-anchor": "middle" });

  function drawHistogram() {
    const counts = new Array(BINS).fill(0);
    let total = 0;
    let largest = 0;
    for (const ev of spectra) {
      for (const lam of ev) {
        const x = lam / Math.sqrt(L);
        const b = Math.floor((x - X0) / bw);
        if (b >= 0 && b < BINS) counts[b]++;
        total++;
      }
      largest += ev[ev.length - 1] / Math.sqrt(L);
    }
    if (!total) return;
    for (let b = 0; b < BINS; b++) {
      const top = sy(counts[b] / (total * bw));
      bars[b].setAttribute("y", top.toFixed(2));
      bars[b].setAttribute("height", (py0 - top).toFixed(2));
    }
    const mx = sx(Math.min(largest / spectra.length, X1 - 0.1));
    marker.setAttribute("d", `M${mx.toFixed(2)} ${py0}L${mx.toFixed(2)} 7`);
    markerText.setAttribute("x", Math.min(Math.max(mx, 14), 70).toFixed(2));
    markerText.textContent = `${root.dataset.largest} ${fmtNumber(largest / spectra.length, 1)}`;
  }

  function sampleSpectrum() {
    const sign = model.magnetization() < 0 ? -1 : 1;
    const a = new Float64Array(L * L);
    const s = model.s;
    for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) a[i * L + j] = (sign * (s[i * L + j] + s[j * L + i])) / 2;
    spectra.push(symmetricEigenvalues(a, L));
    if (spectra.length > KEEP) spectra.shift();
  }

  // ---- lattice (canvas) ----
  const readColors = () => {
    colors = { ink: cssVar("--ink"), muted: cssVar("--muted") };
  };
  function setupCanvas() {
    size = Math.floor(canvas.parentElement.clientWidth);
    if (size) ctx = fitCanvas(canvas, size, size);
  }
  function drawLattice() {
    if (!ctx) return;
    const pitch = size / L;
    ctx.clearRect(0, 0, size, size);
    for (const [up, color, r, alpha] of [[false, colors.muted, 0.13, 0.6], [true, colors.ink, 0.38, 1]]) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.beginPath();
      for (let k = 0; k < L * L; k++) {
        if (model.s[k] > 0 !== up) continue;
        const x = ((k % L) + 0.5) * pitch;
        const y = (Math.floor(k / L) + 0.5) * pitch;
        ctx.moveTo(x + r * pitch, y);
        ctx.arc(x, y, r * pitch, 0, 2 * Math.PI);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---- controls ----
  function setT(value, fromSlider = false) {
    T = value;
    if (!fromSlider) slider.value = String(value);
    tValue.textContent = fmtNumber(T, 2);
    spectra = [];
    const nearest = steps.reduce((a, b) => (Math.abs(Number(b.dataset.step) - T) < Math.abs(Number(a.dataset.step) - T) ? b : a));
    for (const s of steps) s.setAttribute("aria-pressed", String(s === nearest));
    for (const n of notes) n.hidden = n.dataset.note !== nearest.dataset.step;
    if (reducedMotion.matches) settle();
  }
  function settle() {
    for (let s = 0; s < 200; s++) {
      model.sweep(T);
      if (s % 4 === 3) sampleSpectrum();
    }
    drawLattice();
    drawHistogram();
  }
  slider.addEventListener("input", () => setT(Number(slider.value), true));
  for (const s of steps) s.addEventListener("click", () => setT(Number(s.dataset.step)));

  readColors();
  setupCanvas();
  for (let s = 0; s < 300; s++) model.sweep(T);
  setT(T_CRITICAL);
  settle();
  new ResizeObserver(() => {
    setupCanvas();
    drawLattice();
  }).observe(canvas.parentElement);
  onThemeChange(() => {
    readColors();
    drawLattice();
  });

  if (!reducedMotion.matches) {
    animate(canvas, () => {
      model.sweep(T);
      frame++;
      drawLattice();
      if (frame % 5 === 0) sampleSpectrum();
      if (frame % 10 === 0) drawHistogram();
    });
  }
}

const root = document.querySelector("[data-spectrum]");
if (root) start(root);

// Shared helpers for the interactive pieces. No dependencies, nothing leaves the browser.

export const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Calls fn whenever the light/dark theme changes (toggle or system setting).
export function onThemeChange(fn) {
  new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", fn);
}

// Sizes a canvas for sharp drawing on high-density screens; returns a context in CSS pixels.
export function fitCanvas(canvas, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// Runs step(dt) once per frame, but only while el is on screen and the tab is visible.
export function animate(el, step) {
  let onScreen = false;
  let raf = 0;
  let last = 0;
  const loop = (t) => {
    const dt = Math.min((t - last) / 1000, 0.05);
    last = t;
    step(dt);
    raf = requestAnimationFrame(loop);
  };
  const update = () => {
    const run = onScreen && !document.hidden;
    if (run && !raf) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  new IntersectionObserver((entries) => {
    onScreen = entries[0].isIntersecting;
    update();
  }).observe(el);
  document.addEventListener("visibilitychange", update);
}

// Small seeded random number generator, so a given input always gives the same result.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Number formatting that matches the site text: "€289,000" in English, "289 000 €" in Spanish.
export function lang() {
  return document.documentElement.lang === "es" ? "es" : "en";
}

export function fmtNumber(v, digits = 0) {
  const fixed = Math.abs(v).toFixed(digits);
  const [int, frac] = fixed.split(".");
  const sep = lang() === "es" ? " " : ",";
  const grouped = lang() === "es" && int.length <= 4 ? int : int.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const dec = lang() === "es" ? "," : ".";
  return (v < 0 ? "−" : "") + grouped + (frac ? dec + frac : "");
}

export function fmtEuro(v) {
  return lang() === "es" ? fmtNumber(v) + " €" : "€" + fmtNumber(v);
}

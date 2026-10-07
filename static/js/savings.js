// Toolkit page: a savings-plan calculator. It resamples real euro-area months since 1999 with a
// stationary block bootstrap (mean block 12 months, the toolkit's default), so calm and crisis
// periods keep their length. Amounts are in today's money: the monthly amount rises with
// inflation and returns are deflated by it. Fund costs 0.2% a year. No tax, unlike the full model.

import { fmtEuro, fmtNumber, mulberry32 } from "./util.js";

const PATHS = 2000;
const MEAN_BLOCK = 12;
const FEE = 0.002;

async function start(root) {
  const data = await fetch(root.dataset.src).then((r) => r.json());
  const months = data.world_equity.length;
  const inputs = Object.fromEntries([...root.querySelectorAll("input[name]")].map((i) => [i.name, i]));
  const out = (key) => root.querySelector(`[data-out="${key}"]`);
  const svg = root.querySelector("svg");
  let pending = 0;

  function simulate(monthly, years, stocks) {
    const real = new Float64Array(months);
    const feeM = Math.pow(1 - FEE, 1 / 12);
    for (let t = 0; t < months; t++) {
      const nominal = stocks * data.world_equity[t] + (1 - stocks) * data.bund_10y[t];
      real[t] = ((1 + nominal) / (1 + data.inflation[t])) * feeM;
    }
    const rng = mulberry32(1000 * years + 7 * monthly + Math.round(stocks * 100));
    const byYear = Array.from({ length: years + 1 }, () => new Float64Array(PATHS));
    for (let p = 0; p < PATHS; p++) {
      let idx = Math.floor(rng() * months);
      let w = 0;
      for (let m = 1; m <= years * 12; m++) {
        if (rng() < 1 / MEAN_BLOCK) idx = Math.floor(rng() * months);
        else idx = (idx + 1) % months;
        w = (w + monthly) * real[idx];
        if (m % 12 === 0) byYear[m / 12][p] = w;
      }
    }
    for (const arr of byYear) arr.sort();
    const q = (arr, f) => arr[Math.min(PATHS - 1, Math.floor(f * PATHS))];
    const pct = byYear.map((arr) => [0.05, 0.25, 0.5, 0.75, 0.95].map((f) => q(arr, f)));
    const final = byYear[years];
    const paid = monthly * 12 * years;
    let below = 0;
    while (below < PATHS && final[below] < paid) below++;
    return { pct, paid, below: Math.round((100 * below) / PATHS) };
  }

  function draw(res, years) {
    const x0 = 9;
    const x1 = 77;
    const y0 = 38;
    const y1 = 4;
    const top = Math.max(res.pct[years][4], res.paid) * 1.05;
    const xy = (yr, v) => [x0 + ((x1 - x0) * yr) / years, y0 - ((y0 - y1) * v) / top];
    const line = (k) => res.pct.map((p, yr) => xy(yr, p[k])).map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("");
    const band = line(4) + res.pct.map((p, yr) => xy(yr, p[0])).reverse().map(([x, y]) => `L${x.toFixed(2)} ${y.toFixed(2)}`).join("") + "Z";
    const [px, py] = xy(years, res.paid);
    const short = (v) => {
      const [num, unit] = v >= 1e6 ? [fmtNumber(v / 1e6, 1), "M"] : [fmtNumber(v / 1000), "k"];
      return document.documentElement.lang === "es" ? `${num}${unit} €` : `€${num}${unit}`;
    };
    // round tick spacing: 1, 2 or 5 times a power of ten, about three ticks
    const raw = top / 3;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const stepV = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const tickVals = [];
    for (let v = 0; v <= top; v += stepV) tickVals.push(v);
    const ticks = tickVals.map((v) => `<text class="tk" x="${x0 - 1.5}" y="${(xy(0, v)[1] + 0.8).toFixed(2)}" text-anchor="end">${short(v)}</text>`).join("");
    const yearTicks = [0, Math.round(years / 2), years].map((yr) => `<text class="tk" x="${xy(yr, 0)[0].toFixed(2)}" y="${y0 + 4}" text-anchor="middle">${yr}</text>`).join("");
    const hits = res.pct
      .map((p, yr) => {
        if (yr === 0) return "";
        const [hx, hy] = xy(yr, p[2]);
        return `<circle class="hit" cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" r=".6" data-tip="${root.dataset.year} ${yr}: ${root.dataset.median} ${fmtEuro(Math.round(p[2] / 1000) * 1000)} · 90%: ${fmtEuro(Math.round(p[0] / 1000) * 1000)} – ${fmtEuro(Math.round(p[4] / 1000) * 1000)}"/>`;
      })
      .join("");
    svg.innerHTML =
      `<path class="hb" d="${band}"/>` +
      `<path class="h" d="${line(1)}"/><path class="h" d="${line(3)}"/>` +
      `<path class="ax" d="M${x0} ${y1 - 1}L${x0} ${y0}L${x1} ${y0}"/>` +
      `<path class="dash" d="M${x0} ${py.toFixed(2)}L${x1} ${py.toFixed(2)}"/>` +
      `<text class="tk" x="${x0 + 1}" y="${(py - 1).toFixed(2)}">${root.dataset.paidLabel} ${short(res.paid)}</text>` +
      `<path class="ln" d="${line(2)}"/>` +
      `<circle class="pt" cx="${px.toFixed(2)}" cy="${xy(years, res.pct[years][2])[1].toFixed(2)}" r=".9"/>` +
      ticks + yearTicks + hits;
  }

  function update() {
    const monthly = Number(inputs.monthly.value);
    const years = Number(inputs.years.value);
    const stocks = Number(inputs.stocks.value) / 100;
    root.querySelector('[data-val="monthly"]').textContent = fmtEuro(monthly);
    root.querySelector('[data-val="years"]').textContent = String(years);
    root.querySelector('[data-val="stocks"]').textContent = `${Math.round(stocks * 100)} / ${Math.round(100 - stocks * 100)}`;
    const res = simulate(monthly, years, stocks);
    const f = res.pct[years];
    const round = (v) => Math.round(v / 1000) * 1000;
    out("paid").textContent = fmtEuro(round(res.paid));
    out("median").textContent = fmtEuro(round(f[2]));
    out("range").textContent = `${fmtEuro(round(f[0]))} – ${fmtEuro(round(f[4]))}`;
    out("below").textContent = `${fmtNumber(res.below)} / 100`;
    draw(res, years);
  }

  for (const input of Object.values(inputs)) {
    input.addEventListener("input", () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(update);
    });
  }
  update();
}

const root = document.querySelector("[data-savings]");
if (root) start(root);

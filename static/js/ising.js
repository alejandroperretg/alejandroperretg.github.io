// 2D Ising model on an n x n periodic lattice, J = 1, k_B = 1.
// Checkerboard Metropolis updates, as in the thesis. Each site also carries a local "heat"
// that is added to the temperature, so a visitor can warm part of the lattice.

export const T_CRITICAL = 2 / Math.log(1 + Math.SQRT2); // Onsager, about 2.269

export class Ising {
  constructor(n, rng = Math.random) {
    this.n = n;
    this.s = new Int8Array(n * n).fill(1);
    this.heat = new Float32Array(n * n);
    this.rng = rng;
  }

  // One sweep: every site gets one Metropolis update attempt.
  sweep(T) {
    const { n, s, heat, rng } = this;
    for (let parity = 0; parity < 2; parity++) {
      for (let i = 0; i < n; i++) {
        const row = i * n;
        const up = ((i + n - 1) % n) * n;
        const down = ((i + 1) % n) * n;
        for (let j = (i + parity) & 1; j < n; j += 2) {
          const k = row + j;
          const sum = s[up + j] + s[down + j] + s[row + ((j + 1) % n)] + s[row + ((j + n - 1) % n)];
          const dE = 2 * s[k] * sum;
          if (dE <= 0 || rng() < Math.exp(-dE / (T + heat[k]))) s[k] = -s[k];
        }
      }
    }
  }

  magnetization() {
    let m = 0;
    for (let k = 0; k < this.s.length; k++) m += this.s[k];
    return m / this.s.length;
  }

  // Adds a Gaussian patch of extra temperature around lattice coordinates (ci, cj).
  warm(ci, cj, radius, amount) {
    const { n, heat } = this;
    const r = Math.ceil(radius * 2);
    for (let di = -r; di <= r; di++) {
      for (let dj = -r; dj <= r; dj++) {
        const i = Math.round(ci) + di;
        const j = Math.round(cj) + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const k = i * n + j;
        heat[k] = Math.min(heat[k] + amount * Math.exp(-(di * di + dj * dj) / (2 * radius * radius)), 4);
      }
    }
  }

  cool(factor) {
    const h = this.heat;
    for (let k = 0; k < h.length; k++) h[k] *= factor;
  }
}

// Eigenvalues of a real symmetric n x n matrix (row-major Float64Array, overwritten),
// by cyclic Jacobi rotations. Fine for n of a few dozen.
export function symmetricEigenvalues(a, n) {
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q];
    if (off < 1e-18) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p * n + q];
        if (Math.abs(apq) < 1e-15) continue;
        const app = a[p * n + p];
        const aqq = a[q * n + q];
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k * n + p];
          const akq = a[k * n + q];
          a[k * n + p] = c * akp - s * akq;
          a[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p * n + k];
          const aqk = a[q * n + k];
          a[p * n + k] = c * apk - s * aqk;
          a[q * n + k] = s * apk + c * aqk;
        }
      }
    }
  }
  const out = new Float64Array(n);
  for (let k = 0; k < n; k++) out[k] = a[k * n + k];
  return out.sort();
}

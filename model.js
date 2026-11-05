/* Forecast engine. Pure functions with no page access, so it also runs in Node for testing.
   Months are stored as integers: year * 12 + (month - 1). */
(function (root) {
  "use strict";

  const toIndex = (d) => { const [y, m] = d.split("-").map(Number); return y * 12 + m - 1; };
  const toLabel = (i) => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

  function solve(A, b) {
    const n = b.length;
    const M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      if (Math.abs(M[c][c]) < 1e-10) M[c][c] = 1e-10;
      for (let r = c + 1; r < n; r++) {
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
      x[r] = s / M[r][r];
    }
    return x;
  }

  function ols(rows, y) {
    const p = rows[0].length;
    const A = Array.from({ length: p }, () => new Array(p).fill(0));
    const b = new Array(p).fill(0);
    rows.forEach((r, n) => {
      for (let i = 0; i < p; i++) {
        b[i] += r[i] * y[n];
        for (let j = 0; j < p; j++) A[i][j] += r[i] * r[j];
      }
    });
    for (let i = 0; i < p; i++) A[i][i] += 1e-8;
    return solve(A, b);
  }

  /* Trend plus seasonal cycle. t is in years, measured from the forecast origin. */
  const features = (idx, origin, degree, harmonics) => {
    const t = (idx - origin) / 12;
    const r = [1];
    for (let d = 1; d <= degree; d++) r.push(t ** d);
    for (let k = 1; k <= harmonics; k++) {
      const a = (2 * Math.PI * k * (idx % 12)) / 12;
      r.push(Math.sin(a), Math.cos(a));
    }
    return r;
  };
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);

  function fitRegression(hist, windowLen, degree, harmonics) {
    const h = hist.slice(-windowLen);
    const origin = h[h.length - 1].i;
    const beta = ols(h.map((p) => features(p.i, origin, degree, harmonics)), h.map((p) => p.v));
    const predict = (i) => dot(features(i, origin, degree, harmonics), beta);
    const resid = h.map((p) => p.v - predict(p.i));
    return { h, origin, predict, resid };
  }

  const HARMONICS = 3;

  const MODELS = {
    naive: {
      name: "Same month last year",
      note: "The simple baseline every other method has to beat",
      run(hist, steps) {
        const lookup = new Map(hist.map((p) => [p.i, p.v]));
        const origin = hist[hist.length - 1].i;
        return Array.from({ length: steps }, (_, s) => {
          let i = origin + s + 1;
          while (i > origin) i -= 12;
          return lookup.has(i) ? lookup.get(i) : hist[hist.length - 1].v;
        });
      },
    },
    linear: {
      name: "Linear trend",
      note: "Straight 15-year trend plus the seasonal cycle",
      run(hist, steps) {
        const f = fitRegression(hist, 180, 1, HARMONICS);
        return Array.from({ length: steps }, (_, s) => f.predict(f.origin + s + 1));
      },
    },
    curve: {
      name: "Curved trend",
      note: "20-year trend that can speed up or slow down",
      run(hist, steps) {
        const f = fitRegression(hist, 240, 2, HARMONICS);
        return Array.from({ length: steps }, (_, s) => f.predict(f.origin + s + 1));
      },
    },
    memory: {
      name: "Trend with memory",
      note: "Linear trend, plus recent departures that fade over time",
      run(hist, steps) {
        const f = fitRegression(hist, 180, 1, HARMONICS);
        const r = f.resid;
        let num = 0, den = 0;
        for (let k = 1; k < r.length; k++) { num += r[k] * r[k - 1]; den += r[k - 1] * r[k - 1]; }
        const phi = Math.max(0, Math.min(0.98, den ? num / den : 0));
        const last = r[r.length - 1];
        return Array.from({ length: steps }, (_, s) => f.predict(f.origin + s + 1) + last * phi ** (s + 1));
      },
    },
    holt: {
      name: "Damped level and slope",
      note: "Follows the recent level and slope, then flattens the slope",
      run(hist, steps) {
        const f = fitRegression(hist, 240, 1, HARMONICS);
        const trendOnly = fitTrendAndSeason(f.h);
        const clean = f.h.map((p) => p.v - trendOnly.seasonal(p.i));
        let best = null;
        for (const a of [0.2, 0.4, 0.6, 0.8]) {
          for (const b of [0.02, 0.05, 0.1, 0.2]) {
            let level = clean[0], slope = (clean[12] - clean[0]) / 12, sse = 0;
            for (let t = 1; t < clean.length; t++) {
              const pred = level + 0.98 * slope;
              const err = clean[t] - pred;
              sse += err * err;
              const newLevel = pred + a * err;
              slope = 0.98 * slope + b * (newLevel - level - 0.98 * slope);
              level = newLevel;
            }
            if (!best || sse < best.sse) best = { sse, level, slope };
          }
        }
        const out = [];
        let damp = 0, phi = 1;
        for (let s = 1; s <= steps; s++) {
          phi *= 0.98;
          damp += phi;
          out.push(best.level + damp * best.slope + trendOnly.seasonal(f.origin + s));
        }
        return out;
      },
    },
  };

  function fitTrendAndSeason(h) {
    const origin = h[h.length - 1].i;
    const beta = ols(h.map((p) => features(p.i, origin, 1, HARMONICS)), h.map((p) => p.v));
    return {
      seasonal(i) { return dot(features(i, origin, 1, HARMONICS).slice(2), beta.slice(2)); },
    };
  }

  const BLEND = ["linear", "curve", "memory", "holt"];
  const ALL = ["naive", ...BLEND];
  const MAX_STEPS = 48;

  function weightsFromErrors(errs) {
    const inv = BLEND.map((m) => {
      const e = errs[m];
      if (!e.length) return 1;
      return 1 / (mean(e.map((x) => x * x)) + 1e-12);
    });
    const total = inv.reduce((s, v) => s + v, 0);
    const w = {};
    BLEND.forEach((m, k) => { w[m] = inv[k] / total; });
    return w;
  }

  const blendAt = (fc, w, s) => BLEND.reduce((sum, m) => sum + w[m] * fc[m][s], 0);

  const quantile = (a, q) => {
    if (!a.length) return NaN;
    const s = [...a].sort((x, y) => x - y);
    const pos = (s.length - 1) * q;
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };

  /* Half-width of an 80% band for each step ahead, from past absolute errors. */
  function bandFromErrors(byStep, steps) {
    const out = [];
    let floor = 0;
    for (let s = 0; s < steps; s++) {
      const pool = [];
      for (let k = Math.max(0, s - 2); k <= Math.min(byStep.length - 1, s + 2); k++) pool.push(...byStep[k]);
      const q = pool.length >= 4 ? quantile(pool, 0.8) : floor;
      floor = Math.max(floor, q || 0);
      out.push(floor);
    }
    return out;
  }

  /* Every 3 months over the past 12 years: hide the later data, forecast, then score.
     Blend weights and bands at each test use only errors already known at that date. */
  function backtest(hist) {
    const end = hist[hist.length - 1].i;
    const lookup = new Map(hist.map((p) => [p.i, p.v]));
    const first = Math.max(hist[0].i + 180, end - 144);
    const origins = [];
    for (let o = end - 3; o >= first; o -= 3) origins.unshift(o);

    const runs = origins.map((origin) => {
      const past = hist.filter((p) => p.i <= origin);
      const fc = {};
      ALL.forEach((m) => { fc[m] = MODELS[m].run(past, MAX_STEPS); });
      return { origin, fc };
    });

    const stats = {};
    ALL.concat("blend").forEach((m) => {
      stats[m] = { byStep: Array.from({ length: MAX_STEPS }, () => []) };
    });
    let hits = 0, scored = 0;
    const yearErrors = [];

    runs.forEach((run, r) => {
      const known = Object.fromEntries(BLEND.map((m) => [m, []]));
      const knownBlend = Array.from({ length: MAX_STEPS }, () => []);
      for (let q = 0; q < r; q++) {
        const prev = runs[q];
        for (let s = 0; s < MAX_STEPS; s++) {
          const i = prev.origin + s + 1;
          if (i > run.origin || !lookup.has(i)) break;
          BLEND.forEach((m) => known[m].push(prev.fc[m][s] - lookup.get(i)));
          knownBlend[s].push(Math.abs(prev.blend[s] - lookup.get(i)));
        }
      }
      const w = weightsFromErrors(known);
      run.weights = w;
      run.blend = Array.from({ length: MAX_STEPS }, (_, s) => blendAt(run.fc, w, s));
      run.band = bandFromErrors(knownBlend, MAX_STEPS);

      for (let s = 0; s < MAX_STEPS; s++) {
        const i = run.origin + s + 1;
        if (!lookup.has(i)) continue;
        const actual = lookup.get(i);
        ALL.forEach((m) => stats[m].byStep[s].push(Math.abs(run.fc[m][s] - actual)));
        const e = Math.abs(run.blend[s] - actual);
        stats.blend.byStep[s].push(e);
        if (run.band[s] > 0) { scored++; if (e <= run.band[s]) hits++; }
      }
      /* Error of a 12-month mean, 13 to 24 months ahead. */
      const yr = [];
      for (let s = 12; s < 24; s++) if (lookup.has(run.origin + s + 1)) yr.push(lookup.get(run.origin + s + 1));
      if (yr.length === 12) yearErrors.push(Math.abs(mean(run.blend.slice(12, 24)) - mean(yr)));
    });

    const score = (m, a, b) => {
      const pool = [];
      for (let s = a; s < b; s++) pool.push(...stats[m].byStep[s]);
      return pool.length ? mean(pool) : NaN;
    };
    const mae = {};
    ALL.concat("blend").forEach((m) => {
      mae[m] = { near: score(m, 0, 12), far: score(m, 12, 24), all: score(m, 0, 24) };
    });

    const finalKnown = Object.fromEntries(BLEND.map((m) => [m, []]));
    runs.forEach((run) => {
      for (let s = 0; s < 24; s++) {
        const i = run.origin + s + 1;
        if (!lookup.has(i)) break;
        BLEND.forEach((m) => finalKnown[m].push(run.fc[m][s] - lookup.get(i)));
      }
    });

    return {
      runs, mae,
      coverage: scored ? hits / scored : NaN,
      tests: runs.length,
      weights: weightsFromErrors(finalKnown),
      band: bandFromErrors(stats.blend.byStep, MAX_STEPS),
      yearError: yearErrors.length ? quantile(yearErrors, 0.8) : NaN,
    };
  }

  /* Forecast to October 2028, and the two-year change that answers "what will rise". */
  function analyse(series, targetLabel = "2028-10", snapshotLabel = "2026-10") {
    const hist = series.dates.map((d, k) => ({ i: toIndex(d), v: series.values[k] }));
    const last = hist[hist.length - 1].i;
    const target = toIndex(targetLabel);
    const snap = toIndex(snapshotLabel);
    const steps = Math.min(MAX_STEPS, target - last);
    const bt = backtest(hist);

    const fc = {};
    ALL.forEach((m) => { fc[m] = MODELS[m].run(hist, MAX_STEPS); });
    fc.blend = Array.from({ length: MAX_STEPS }, (_, s) => blendAt(fc, bt.weights, s));

    const valueAt = (i, m = "blend") => {
      const seen = hist.find((p) => p.i === i);
      if (seen) return { v: seen.v, observed: true };
      const s = i - last - 1;
      return s >= 0 && s < MAX_STEPS ? { v: fc[m][s], observed: false, band: bt.band[s] } : { v: NaN, observed: false };
    };
    const yearMean = (endI) => {
      const a = [];
      for (let i = endI - 11; i <= endI; i++) a.push(valueAt(i).v);
      return mean(a);
    };
    const now = yearMean(snap);
    const later = yearMean(target);
    const change = later - now;
    const clear = Math.abs(change) > bt.yearError;
    return {
      hist, last, steps, fc, bt, valueAt, now, later, change, clear,
      direction: change > 0 ? "up" : "down",
      snapshot: valueAt(snap),
      target: valueAt(target),
    };
  }

  const api = { analyse, toIndex, toLabel, MODELS, BLEND, ALL, MAX_STEPS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ForecastModel = api;
})(typeof window !== "undefined" ? window : globalThis);

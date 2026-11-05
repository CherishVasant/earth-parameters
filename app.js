/* Dashboard page. All text from the data file is inserted with textContent. */
(function () {
  "use strict";
  const FM = window.ForecastModel;
  const $ = (id) => document.getElementById(id);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthName = (i) => `${MONTHS[i % 12]} ${Math.floor(i / 12)}`;
  const SNAP = FM.toIndex("2026-10");
  const TARGET = FM.toIndex("2028-10");
  const SVG = "http://www.w3.org/2000/svg";
  const RANGES = [["5 yrs", 60], ["10 yrs", 120], ["20 yrs", 240], ["All", 99999]];
  const NAMES = { blend: "Weighted blend", ...Object.fromEntries(FM.ALL.map((m) => [m, FM.MODELS[m].name])) };

  const state = { param: null, method: "blend", range: 120, horizon: 24, testing: false, testIdx: 0, accRange: "far", size: { w: 960 } };
  let data = [];
  const results = {};

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const svgEl = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v));
    return n;
  };
  const fmt = (s, v, extra = 0) => Number(v).toLocaleString("en-IN", {
    minimumFractionDigits: s.decimals + extra, maximumFractionDigits: s.decimals + extra,
  });
  const signed = (s, v) => `${v >= 0 ? "+" : "−"}${fmt(s, Math.abs(v))}`;
  const unitGap = (s) => (s.unit === "°C" ? "" : " ");
  const lowerName = (s) => (s.id === "seaice" ? s.name : s.name.toLowerCase());
  const callText = (r) => {
    if (r.clear) return r.direction === "up" ? "Clear rise" : "Clear fall";
    return r.direction === "up" ? "Small rise, within error" : "Small fall, within error";
  };
  const arrow = (r) => (r.clear ? (r.direction === "up" ? "▲" : "▼") : (r.direction === "up" ? "△" : "▽"));

  /* ---------- theme ---------- */
  function currentTheme() {
    const t = document.documentElement.dataset.theme;
    if (t) return t;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function setThemeLabel() { $("theme").textContent = currentTheme() === "dark" ? "Light theme" : "Dark theme"; }
  try {
    const saved = localStorage.getItem("evs-theme");
    if (saved) document.documentElement.dataset.theme = saved;
  } catch (e) { /* storage may be blocked */ }
  setThemeLabel();
  $("theme").addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("evs-theme", next); } catch (e) { /* storage may be blocked */ }
    setThemeLabel();
  });

  /* ---------- static sections ---------- */
  function renderAnswer() {
    const clearUp = data.filter((s) => results[s.id].clear && results[s.id].direction === "up");
    const unclear = data.filter((s) => !results[s.id].clear);
    const part = (s) => `${lowerName(s)} (${signed(s, results[s.id].change)}${unitGap(s)}${s.unit})`;
    const list = (a) => (a.length < 2 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a[a.length - 1]}`);
    let text = `By October 2028, ${list(clearUp.map(part))} ${clearUp.length === 1 ? "is" : "are"} forecast to rise clearly.`;
    if (unclear.length) {
      text += ` The change in ${list(unclear.map(part))} is smaller than the usual forecast error, so its direction is less certain.`;
    }
    $("answer").textContent = text;
  }

  function renderTiles() {
    const box = $("tiles");
    box.textContent = "";
    data.forEach((s) => {
      const r = results[s.id];
      const b = el("button", "tile");
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.param === s.id));
      b.append(el("span", "tile-name", s.short));
      const v = el("span", "tile-value", fmt(s, r.target.v));
      v.append(el("span", "tile-unit", ` ${s.unit}`));
      b.append(v);
      b.append(el("span", "tile-call", "forecast, Oct 2028"));
      b.append(el("span", "tile-change", `${arrow(r)} ${signed(s, r.change)} over 2 years`));
      b.addEventListener("click", () => selectParam(s.id));
      box.append(b);
    });
  }

  function renderTable() {
    const t = $("table");
    t.textContent = "";
    const head = el("thead");
    const hr = el("tr");
    [["Parameter"], ["Latest record"], ["Oct 2026"], ["Oct 2028 forecast"], ["80% band"], ["Change"], ["Outlook", "call"]].forEach(([h, c]) => hr.append(el("th", c, h)));
    head.append(hr);
    const body = el("tbody");
    data.forEach((s) => {
      const r = results[s.id];
      const row = el("tr");
      row.tabIndex = 0;
      row.append(el("td", null, `${s.name} (${s.unit})`));
      row.append(el("td", null, `${fmt(s, s.values[s.values.length - 1])}, ${monthName(r.last)}`));
      const snap = el("td", null, fmt(s, r.snapshot.v));
      snap.append(el("span", "est", r.snapshot.observed ? " recorded" : " estimated"));
      row.append(snap);
      row.append(el("td", null, fmt(s, r.target.v)));
      row.append(el("td", null, `±${fmt(s, r.target.band)}`));
      row.append(el("td", null, signed(s, r.change)));
      row.append(el("td", "call", `${arrow(r)} ${callText(r)}`));
      const go = () => { selectParam(s.id); $("chart-title").scrollIntoView({ behavior: "smooth", block: "center" }); };
      row.addEventListener("click", go);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      body.append(row);
    });
    t.append(head, body);
  }

  function renderSources() {
    const ul = $("sources");
    data.forEach((s) => {
      const li = el("li");
      li.append(document.createTextNode(`${s.name}: `));
      const a = el("a", null, s.source);
      if (/^https:\/\//.test(s.url)) a.href = s.url;
      a.rel = "noopener";
      li.append(a);
      ul.append(li);
    });
  }

  /* ---------- main chart ---------- */
  function niceTicks(lo, hi, count) {
    const span = hi - lo || 1;
    const raw = span / count;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((m) => m >= raw) || raw;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Number(v.toFixed(6)));
    return { ticks: out, step };
  }

  function chartSeries() {
    const s = data.find((d) => d.id === state.param);
    const r = results[s.id];
    const end = SNAP + state.horizon;
    const method = state.method;
    const fc = [];
    for (let i = r.last + 1; i <= Math.max(end, r.last + 1); i++) {
      const k = i - r.last - 1;
      if (k >= FM.MAX_STEPS) break;
      const band = r.bt.band[k];
      fc.push({ i, v: r.fc[method][k], lo: r.fc[method][k] - band, hi: r.fc[method][k] + band });
    }
    let test = null;
    if (state.testing) {
      const run = r.bt.runs[state.testIdx];
      test = { origin: run.origin, pts: [] };
      for (let k = 0; k < 24; k++) {
        const v = method === "blend" ? run.blend[k] : run.fc[method][k];
        const band = run.band[k] || 0;
        test.pts.push({ i: run.origin + k + 1, v, lo: v - band, hi: v + band });
      }
    }
    return { s, r, fc, test, end };
  }

  function renderChart() {
    const { s, r, fc, test, end } = chartSeries();
    const svg = $("chart");
    svg.textContent = "";
    const W = Math.max(320, $("chart-wrap").clientWidth || 960);
    const H = W < 560 ? 280 : 380;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const m = { l: W < 560 ? 44 : 56, r: 14, t: 12, b: 28 };
    const lastShown = Math.max(end, r.last);
    let first = Math.max(r.hist[0].i, lastShown - state.range);
    if (test) first = Math.min(first, test.origin - 60);
    first = Math.max(first, r.hist[0].i);
    const obs = r.hist.filter((p) => p.i >= first);
    const shownFc = fc.filter((p) => p.i <= lastShown);
    const shownTest = test ? test.pts.filter((p) => p.i <= lastShown) : [];
    const vals = [...obs.map((p) => p.v), ...shownFc.flatMap((p) => [p.lo, p.hi]), ...shownTest.flatMap((p) => [p.lo, p.hi])];
    const pad = (Math.max(...vals) - Math.min(...vals)) * 0.06 || 1;
    const { ticks } = niceTicks(Math.min(...vals) - pad, Math.max(...vals) + pad, W < 560 ? 4 : 6);
    const yLo = Math.min(ticks[0], Math.min(...vals));
    const yHi = Math.max(ticks[ticks.length - 1], Math.max(...vals));
    const x = (i) => m.l + ((i - first) / (lastShown - first || 1)) * (W - m.l - m.r);
    const y = (v) => H - m.b - ((v - yLo) / (yHi - yLo || 1)) * (H - m.t - m.b);
    const dec = Math.max(0, Math.min(3, ticks.length > 1 ? Math.ceil(-Math.log10(ticks[1] - ticks[0] + 1e-9)) : 0));

    ticks.forEach((t) => {
      svg.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: y(t), y2: y(t), stroke: "var(--grid)", "stroke-width": 1 }));
      const lab = svgEl("text", { x: m.l - 8, y: y(t) + 4, "text-anchor": "end" });
      lab.textContent = t.toLocaleString("en-IN", { minimumFractionDigits: dec, maximumFractionDigits: dec });
      svg.append(lab);
    });
    const yrSpan = (lastShown - first) / 12;
    const yrStep = [1, 2, 5, 10, 20, 50].find((n) => ((W - m.l - m.r) / yrSpan) * n >= 48) || 50;
    for (let yr = Math.ceil(first / 12 / yrStep) * yrStep; yr * 12 <= lastShown; yr += yrStep) {
      const lab = svgEl("text", { x: x(yr * 12), y: H - 8, "text-anchor": "middle" });
      lab.textContent = String(yr);
      svg.append(lab);
    }

    const path = (pts, key = "v") => pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join("");
    const area = (pts) => `${path(pts, "hi")}${[...pts].reverse().map((p) => `L${x(p.i).toFixed(1)} ${y(p.lo).toFixed(1)}`).join("")}Z`;

    if (shownFc.length) {
      svg.append(svgEl("path", { d: area(shownFc), fill: "var(--band)" }));
      const nowX = x(r.last);
      svg.append(svgEl("line", { x1: nowX, x2: nowX, y1: m.t, y2: H - m.b, stroke: "var(--line)", "stroke-width": 1 }));
    }
    svg.append(svgEl("path", { d: path(obs), fill: "none", stroke: "var(--observed)", "stroke-width": 2, "stroke-linejoin": "round" }));
    if (shownFc.length) {
      const joined = [{ i: r.last, v: r.hist[r.hist.length - 1].v }, ...shownFc];
      svg.append(svgEl("path", { d: path(joined), fill: "none", stroke: "var(--forecast)", "stroke-width": 2, "stroke-dasharray": "5 4" }));
    }
    if (shownTest.length) {
      svg.append(svgEl("path", { d: path(shownTest), fill: "none", stroke: "var(--test)", "stroke-width": 2, "stroke-dasharray": "2 3" }));
      const ox = x(test.origin);
      svg.append(svgEl("line", { x1: ox, x2: ox, y1: m.t, y2: H - m.b, stroke: "var(--test)", "stroke-width": 1, "stroke-dasharray": "2 3" }));
    }

    const cross = svgEl("line", { y1: m.t, y2: H - m.b, stroke: "var(--ink-3)", "stroke-width": 1, visibility: "hidden" });
    const dot1 = svgEl("circle", { r: 4, fill: "var(--observed)", stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });
    const dot2 = svgEl("circle", { r: 4, fill: "var(--forecast)", stroke: "var(--surface)", "stroke-width": 2, visibility: "hidden" });
    svg.append(cross, dot1, dot2);

    const obsMap = new Map(obs.map((p) => [p.i, p.v]));
    const fcMap = new Map(shownFc.map((p) => [p.i, p]));
    const testMap = new Map(shownTest.map((p) => [p.i, p]));
    const tip = $("tip");
    let current = null;
    function show(i) {
      i = Math.max(first, Math.min(lastShown, i));
      current = i;
      const px = x(i);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
      tip.textContent = "";
      tip.append(el("div", "tip-date", monthName(i)));
      const row = (color, value, label, dash) => {
        const d = el("div", "tip-row");
        const key = el("span", dash ? "key dash" : "key");
        key.style.borderTopColor = color;
        d.append(key, el("strong", null, `${value}${unitGap(s)}${s.unit}`), el("em", null, label));
        tip.append(d);
      };
      if (obsMap.has(i)) {
        row("var(--observed)", fmt(s, obsMap.get(i)), "recorded");
        dot1.setAttribute("cx", px); dot1.setAttribute("cy", y(obsMap.get(i))); dot1.setAttribute("visibility", "visible");
      } else dot1.setAttribute("visibility", "hidden");
      if (fcMap.has(i)) {
        const f = fcMap.get(i);
        row("var(--forecast)", fmt(s, f.v), "forecast", true);
        const b = el("div", "tip-row");
        b.append(el("em", null, `Band ${fmt(s, f.lo)} to ${fmt(s, f.hi)}`));
        tip.append(b);
        dot2.setAttribute("cx", px); dot2.setAttribute("cy", y(f.v)); dot2.setAttribute("visibility", "visible");
      } else dot2.setAttribute("visibility", "hidden");
      if (testMap.has(i)) row("var(--test)", fmt(s, testMap.get(i).v), "test forecast", true);
      tip.hidden = false;
      const box = $("chart-wrap").clientWidth;
      const scale = box / W;
      const tw = tip.offsetWidth;
      const left = px * scale + 12 + tw > box ? px * scale - tw - 12 : px * scale + 12;
      tip.style.left = `${Math.max(0, left)}px`;
    }
    function hide() {
      current = null;
      tip.hidden = true;
      [cross, dot1, dot2].forEach((n) => n.setAttribute("visibility", "hidden"));
    }
    svg.onpointermove = (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * W;
      show(Math.round(first + ((px - m.l) / (W - m.l - m.r)) * (lastShown - first)));
    };
    svg.onpointerleave = hide;
    svg.onblur = hide;
    svg.onkeydown = (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        show((current === null ? lastShown : current) + (e.key === "ArrowLeft" ? -1 : 1));
      } else if (e.key === "Escape") hide();
    };
    svg.onfocus = () => show(lastShown);
    svg.setAttribute("aria-label", `${s.name} from ${monthName(first)} to ${monthName(lastShown)}. Use the left and right arrow keys to read values.`);

    $("chart-title").textContent = `${s.name}, ${s.unit}`;
    const t = r.valueAt(end, state.method);
    const endTxt = Number.isFinite(t.v) ? `${monthName(end)}: ${fmt(s, t.v)}${unitGap(s)}${s.unit}${t.observed ? " recorded" : " forecast"}.` : "";
    $("chart-note").textContent = `${s.note}. Latest record ${monthName(r.last)}. ${endTxt}`;

    const legend = $("legend");
    legend.textContent = "";
    const add = (cls, color, text) => {
      const sp = el("span");
      const k = el("i", cls);
      if (color) k.style.borderTopColor = color;
      sp.append(k, document.createTextNode(text));
      legend.append(sp);
    };
    add("key", "var(--observed)", "Recorded");
    add("key dash", "var(--forecast)", `Forecast: ${NAMES[state.method]}`);
    add("key area", null, "80% band");
    if (test) add("key dash", "var(--test)", "Test forecast");

    renderTestNote(s, r, test);
  }

  function renderTestNote(s, r, test) {
    const note = $("test-note");
    note.hidden = !test;
    if (!test) return;
    $("test-out").textContent = monthName(test.origin);
    const lookup = new Map(r.hist.map((p) => [p.i, p.v]));
    const errs = test.pts.filter((p) => lookup.has(p.i)).map((p) => Math.abs(p.v - lookup.get(p.i)));
    note.textContent = errs.length
      ? `This forecast used only data up to ${monthName(test.origin)}. Its average error against the next ${errs.length} months of records was ${fmt(s, errs.reduce((a, b) => a + b, 0) / errs.length, 1)}${unitGap(s)}${s.unit}.`
      : "No later records exist yet for this test.";
  }

  /* ---------- accuracy ---------- */
  function renderAccuracy() {
    const s = data.find((d) => d.id === state.param);
    const r = results[s.id];
    const key = state.accRange;
    const rows = ["blend", ...FM.BLEND, "naive"].map((m) => ({ m, v: r.bt.mae[m][key] }));
    const max = Math.max(...rows.map((d) => d.v));
    const box = $("bars");
    box.textContent = "";
    const best = Math.min(...rows.map((d) => d.v));
    rows.forEach((d) => {
      const row = el("div", d.m === "blend" ? "bar-row best" : "bar-row");
      row.title = d.m === "blend" ? "Weights each method by its past accuracy" : FM.MODELS[d.m].note;
      row.append(el("span", "bar-name", NAMES[d.m]));
      const track = el("div", "bar-track");
      const fill = el("div", "bar-fill");
      fill.style.width = `calc((100% - 72px) * ${(d.v / max).toFixed(4)})`;
      track.append(fill, el("span", "bar-value", `${fmt(s, d.v, 1)}${d.v === best ? " lowest" : ""}`));
      row.append(track);
      box.append(row);
    });
    const gain = 1 - r.bt.mae.blend[key] / r.bt.mae.naive[key];
    $("acc-note").textContent = `Average error in ${s.unit}, from ${r.bt.tests} past tests. The blend was ${Math.round(gain * 100)}% ${gain >= 0 ? "more accurate" : "less accurate"} than the baseline for ${lowerName(s)}.`;

    const facts = $("facts");
    facts.textContent = "";
    [["Past tests", String(r.bt.tests)], ["Error cut vs baseline", `${Math.round(gain * 100)}%`], ["Inside 80% band", `${Math.round(r.bt.coverage * 100)}%`]].forEach(([k, v]) => {
      const wrap = el("div");
      wrap.append(el("dt", null, k), el("dd", null, v));
      facts.append(wrap);
    });
  }

  /* ---------- controls ---------- */
  function buildSeg(box, items, get, set) {
    box.textContent = "";
    items.forEach(([label, value]) => {
      const b = el("button", null, label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(get() === value));
      b.addEventListener("click", () => {
        set(value);
        [...box.children].forEach((c, k) => c.setAttribute("aria-pressed", String(items[k][1] === value)));
      });
      box.append(b);
    });
  }

  function syncTestSlider() {
    const r = results[state.param];
    const t = $("test");
    t.max = r.bt.runs.length - 1;
    state.testIdx = Math.min(state.testIdx, r.bt.runs.length - 1);
    if (!state.testTouched) state.testIdx = Math.max(0, r.bt.runs.length - 25);
    t.value = state.testIdx;
  }

  function selectParam(id) {
    state.param = id;
    $("param").value = id;
    [...$("tiles").children].forEach((b, k) => b.setAttribute("aria-pressed", String(data[k].id === id)));
    syncTestSlider();
    renderChart();
    renderAccuracy();
  }

  function setHorizonLabel() { $("horizon-out").textContent = monthName(SNAP + state.horizon); }

  function downloadCSV() {
    const lines = ["parameter,unit,month,forecast,band_low,band_high"];
    data.forEach((s) => {
      const r = results[s.id];
      for (let k = 0; k < r.steps; k++) {
        const v = r.fc.blend[k], b = r.bt.band[k];
        lines.push([`"${s.name}"`, `"${s.unit}"`, FM.toLabel(r.last + k + 1), v.toFixed(3), (v - b).toFixed(3), (v + b).toFixed(3)].join(","));
      }
    });
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = el("a");
    a.href = url;
    a.download = "earth-vital-signs-forecast.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function wire() {
    data.forEach((s) => {
      const o = el("option", null, s.name);
      o.value = s.id;
      $("param").append(o);
    });
    ["blend", ...FM.BLEND, "naive"].forEach((m) => {
      const o = el("option", null, NAMES[m]);
      o.value = m;
      $("method").append(o);
    });
    $("param").addEventListener("change", (e) => selectParam(e.target.value));
    $("method").addEventListener("change", (e) => { state.method = e.target.value; renderChart(); });
    buildSeg($("range"), RANGES, () => state.range, (v) => { state.range = v; renderChart(); });
    buildSeg($("acc-range"), [["1-12 months ahead", "near"], ["13-24 months ahead", "far"]], () => state.accRange, (v) => { state.accRange = v; renderAccuracy(); });
    $("horizon").addEventListener("input", (e) => { state.horizon = Number(e.target.value); setHorizonLabel(); renderChart(); });
    $("test-on").addEventListener("change", (e) => {
      state.testing = e.target.checked;
      $("test-field").hidden = !state.testing;
      syncTestSlider();
      renderChart();
    });
    $("test").addEventListener("input", (e) => { state.testIdx = Number(e.target.value); state.testTouched = true; renderChart(); });
    $("csv").addEventListener("click", downloadCSV);
    let timer;
    window.addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(renderChart, 120); });
  }

  async function start() {
    try {
      const res = await fetch("data/climate.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      const payload = await res.json();
      data = payload.series;
      data.forEach((s) => { results[s.id] = FM.analyse(s); });
      $("stamp").textContent = `Data checked ${payload.updated}`;
      state.param = data[0].id;
      wire();
      setHorizonLabel();
      renderAnswer();
      renderTiles();
      renderTable();
      renderSources();
      selectParam(state.param);
    } catch (err) {
      $("answer").textContent = "The data file could not be loaded. If you opened this page directly from a folder, run it through a web server or GitHub Pages.";
      console.error(err);
    }
  }
  start();
})();

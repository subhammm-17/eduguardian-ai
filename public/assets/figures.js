// Figures for EduGuardian AI: landing-page illustrations, study diagrams and
// small charts. Every figure is plain SVG built from strings. Colours come from
// CSS classes in styles.css (".fig …"), so they always follow the theme.
//
// Use it in HTML with <div data-figure="parabola"></div> and call
// renderFigures(), or call figure("parabola") to get the SVG string.

const f1 = (n) => Math.round(n * 10) / 10;

// Arrow from (x1, y1) to (x2, y2) with a small filled head.
function arrow(x1, y1, x2, y2, cls = "ln", head = 7) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const p = (t) => `${f1(x2 - head * Math.cos(a + t))},${f1(y2 - head * Math.sin(a + t))}`;
  return `<line class="${cls}" x1="${x1}" y1="${y1}" x2="${f1(x2 - head * 0.6 * Math.cos(a))}" y2="${f1(y2 - head * 0.6 * Math.sin(a))}"/>
    <polygon class="${cls}-head" points="${x2},${y2} ${p(0.45)} ${p(-0.45)}"/>`;
}

const svg = (w, h, body, label) =>
  `<svg class="fig" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">${body}</svg>`;

/* ---------- Maths ---------- */

// Plot y = fn(x) with labelled points. Used for graphs under maths answers.
function plot({ fn, x: [x0, x1], y: [y0, y1], points = [], w = 340, h = 210, label, curveLabel }) {
  const pad = 28;
  const sx = (x) => pad + ((x - x0) / (x1 - x0)) * (w - pad * 2);
  const sy = (y) => h - pad - ((y - y0) / (y1 - y0)) * (h - pad * 2);
  let grid = "";
  for (let x = Math.ceil(x0); x <= x1; x++) {
    grid += `<line class="grid" x1="${sx(x)}" y1="${pad}" x2="${sx(x)}" y2="${h - pad}"/>`;
    if (x !== 0) grid += `<text x="${sx(x)}" y="${h - pad + 15}" text-anchor="middle">${x}</text>`;
  }
  for (let y = Math.ceil(y0); y <= y1; y += 2) {
    grid += `<line class="grid" x1="${pad}" y1="${sy(y)}" x2="${w - pad}" y2="${sy(y)}"/>`;
  }
  // Sample the curve and keep only the part inside the box.
  let d = "";
  let pen = false;
  for (let i = 0; i <= 120; i++) {
    const x = x0 + ((x1 - x0) * i) / 120;
    const y = fn(x);
    if (y < y0 || y > y1) { pen = false; continue; }
    d += `${pen ? "L" : "M"}${f1(sx(x))},${f1(sy(y))}`;
    pen = true;
  }
  const axes = `<line class="ax" x1="${pad}" y1="${sy(0)}" x2="${w - pad}" y2="${sy(0)}"/>
    <line class="ax" x1="${sx(Math.max(0, x0))}" y1="${pad - 6}" x2="${sx(Math.max(0, x0))}" y2="${h - pad}"/>
    <text x="${w - pad + 6}" y="${sy(0) + 4}">x</text><text x="${sx(Math.max(0, x0)) - 4}" y="${pad - 10}">y</text>`;
  const marks = points.map((p) => `<circle class="dot" cx="${sx(p.x)}" cy="${sy(p.y)}" r="5"/>
    <text class="ink" x="${sx(p.x) + (p.dx ?? 0)}" y="${sy(p.y) + (p.dy ?? -11)}" text-anchor="middle">${p.label}</text>`).join("");
  const cl = curveLabel ? `<text class="hl-text" x="${curveLabel.x}" y="${curveLabel.y}">${curveLabel.text}</text>` : "";
  return svg(w, h, grid + axes + `<path class="ln" d="${d}"/>` + marks + cl, label);
}

// Eigenvectors: v keeps its direction under A, w does not.
function eigen() {
  const o = [60, 170];
  const s = 60; // pixels per unit
  const P = (x, y) => [o[0] + x * s, o[1] - y * s];
  const [vx, vy] = P(1, 0), [avx, avy] = P(2.6, 0);
  const [wx, wy] = P(1, 1), [awx, awy] = P(2.6, 1);
  return svg(340, 200, `
    <line class="ax" x1="20" y1="${o[1]}" x2="320" y2="${o[1]}"/>
    <line class="ax" x1="${o[0]}" y1="20" x2="${o[0]}" y2="190"/>
    ${arrow(o[0], o[1], awx, awy, "ln-soft")}
    ${arrow(o[0], o[1], wx, wy, "ln-soft")}
    ${arrow(o[0], o[1], avx, avy, "ln-red")}
    ${arrow(o[0], o[1], vx, vy, "ln")}
    <text class="ink" x="${vx - 6}" y="${vy - 10}">v</text>
    <text class="ink" x="${avx - 18}" y="${avy - 10}">Av = λv</text>
    <text x="${wx - 4}" y="${wy - 10}">w</text>
    <text x="${awx - 8}" y="${awy - 10}">Aw</text>
    <text x="196" y="40">w changes direction</text>
    <text class="hl-text" x="196" y="140">v only stretches</text>`,
    "Diagram: eigenvector v is stretched along its own line by A, while vector w is turned to a new direction");
}

/* ---------- Digital logic ---------- */

// Karnaugh map. `values` is a rows × cols array; `group` highlights one row.
function kmap({ rows, cols, rowVar, colVar, values, group, label }) {
  const c = 46, x0 = 74, y0 = 46;
  const w = x0 + cols.length * c + 24, h = y0 + rows.length * c + 20;
  let cells = "";
  rows.forEach((r, i) => {
    cells += `<text x="${x0 - 10}" y="${y0 + i * c + c / 2 + 4}" text-anchor="end">${r}</text>`;
    cols.forEach((col, j) => {
      const v = values?.[i]?.[j] ?? "";
      cells += `<rect class="box" x="${x0 + j * c}" y="${y0 + i * c}" width="${c}" height="${c}"/>
        <text class="ink big" x="${x0 + j * c + c / 2}" y="${y0 + i * c + c / 2 + 5}" text-anchor="middle">${v}</text>`;
    });
  });
  cols.forEach((col, j) => (cells += `<text x="${x0 + j * c + c / 2}" y="${y0 - 10}" text-anchor="middle">${col}</text>`));
  const g = group !== undefined
    ? `<rect class="group" x="${x0 + 4}" y="${y0 + group * c + 4}" width="${cols.length * c - 8}" height="${c - 8}" rx="14"/>` : "";
  return svg(w, h, `<text class="ink" x="${x0 - 12}" y="${y0 - 26}" text-anchor="end">${rowVar}\\${colVar}</text>` + cells + g, label);
}

function andGate() {
  return svg(240, 120, `
    <line class="ax" x1="30" y1="44" x2="90" y2="44"/><line class="ax" x1="30" y1="76" x2="90" y2="76"/>
    <path class="gate" d="M90 26 H126 A34 34 0 0 1 126 94 H90 Z"/>
    <line class="ln" x1="160" y1="60" x2="214" y2="60"/>
    <circle class="dot" cx="214" cy="60" r="4"/>
    <text class="ink" x="18" y="48">A</text><text class="ink" x="18" y="80">B</text>
    <text class="hl-text" x="170" y="50">A·B</text>`,
    "AND gate with inputs A and B and output A·B");
}

/* ---------- Quantum ---------- */

function bloch() {
  const cx = 120, cy = 110, r = 80;
  return svg(240, 220, `
    <circle class="sphere" cx="${cx}" cy="${cy}" r="${r}"/>
    <ellipse class="dash" cx="${cx}" cy="${cy}" rx="${r}" ry="22"/>
    <line class="ax" x1="${cx}" y1="${cy - r - 8}" x2="${cx}" y2="${cy + r + 8}"/>
    <circle class="dot-soft" cx="${cx}" cy="${cy - r}" r="4"/><circle class="dot-soft" cx="${cx}" cy="${cy + r}" r="4"/>
    ${arrow(cx, cy, cx + 62, cy + 14, "ln")}
    <circle class="dot" cx="${cx}" cy="${cy}" r="3.5"/>
    <text class="ink" x="${cx + 10}" y="${cy - r - 4}">|0⟩</text>
    <text class="ink" x="${cx + 10}" y="${cy + r + 14}">|1⟩</text>
    <text class="hl-text" x="${cx + 64}" y="${cy + 34}">|+⟩</text>`,
    "Bloch sphere: |0⟩ at the top, |1⟩ at the bottom, and the state |+⟩ on the equator");
}

function hadamard() {
  return svg(360, 110, `
    <line class="ax" x1="50" y1="50" x2="260" y2="50"/>
    <text class="ink big" x="16" y="55">|0⟩</text>
    <rect class="gate" x="110" y="28" width="44" height="44" rx="6"/>
    <text class="ink big" x="132" y="56" text-anchor="middle">H</text>
    <rect class="box" x="236" y="28" width="52" height="44" rx="6"/>
    <path class="ln" d="M246 60 A16 16 0 0 1 278 60"/>
    ${arrow(262, 62, 274, 38, "ln", 5)}
    <text x="182" y="96" text-anchor="middle">Measure: 0 or 1, each with probability ½</text>`,
    "Circuit: |0⟩ passes through a Hadamard gate and is then measured");
}

/* ---------- Landing-page illustrations ---------- */

function illoTutor() {
  return svg(240, 130, `
    <rect class="soft" x="16" y="18" width="150" height="48" rx="12"/>
    <rect class="line" x="30" y="32" width="110" height="6" rx="3"/><rect class="line" x="30" y="46" width="76" height="6" rx="3"/>
    <rect class="red-fill" x="120" y="76" width="104" height="38" rx="12"/>
    <text class="on-red" x="172" y="101" text-anchor="middle">Why −5?</text>
    <circle class="hl-fill" cx="36" cy="96" r="14"/><text class="on-hl" x="36" y="101" text-anchor="middle">?</text>
    <rect class="pill" x="56" y="86" width="50" height="20" rx="10"/>`,
    "Illustration: the tutor answers with a guiding question");
}

function illoNotes() {
  return svg(240, 130, `
    <rect class="soft" x="40" y="10" width="110" height="112" rx="8"/>
    <rect class="line" x="56" y="28" width="78" height="6" rx="3"/>
    <rect class="hl-band" x="52" y="44" width="86" height="14" rx="3"/>
    <rect class="line" x="56" y="48" width="70" height="6" rx="3"/>
    <rect class="line" x="56" y="66" width="62" height="6" rx="3"/><rect class="line" x="56" y="80" width="74" height="6" rx="3"/>
    <rect class="line" x="56" y="94" width="50" height="6" rx="3"/>
    <rect class="red-fill" x="146" y="40" width="70" height="24" rx="12"/>
    <text class="on-red" x="181" y="56" text-anchor="middle">[1] p. 4</text>`,
    "Illustration: a page of notes with a highlighted line and a citation");
}

function illoCards() {
  return svg(240, 130, `
    <rect class="soft" x="62" y="26" width="120" height="80" rx="10" transform="rotate(-8 122 66)"/>
    <rect class="soft" x="62" y="26" width="120" height="80" rx="10" transform="rotate(5 122 66)"/>
    <rect class="card-top" x="60" y="22" width="124" height="82" rx="10"/>
    <text class="hl-text big" x="122" y="58" text-anchor="middle">det A = ?</text>
    <rect class="line" x="88" y="72" width="68" height="6" rx="3"/>
    ${[0, 1, 2, 3, 4].map((i) => `<rect class="${i < 3 ? "red-fill" : "pill"}" x="${74 + i * 20}" y="114" width="14" height="8" rx="3"/>`).join("")}`,
    "Illustration: a stack of flashcards and Leitner boxes");
}

function illoRoadmap() {
  let cells = "";
  for (let i = 0; i < 14; i++) {
    const x = 24 + (i % 7) * 26, y = 30 + Math.floor(i / 7) * 34;
    const cls = i < 8 ? "red-fill" : i === 13 ? "hl-fill" : "soft";
    cells += `<rect class="${cls}" x="${x}" y="${y}" width="20" height="26" rx="4"/>`;
  }
  return svg(240, 130, cells + `
    <line class="ax" x1="215" y1="30" x2="215" y2="96"/><path class="hl-fill" d="M215 30 h18 l-6 8 l6 8 h-18 z"/>
    <text x="24" y="118">2 weeks</text><text class="hl-text" x="190" y="118">Exam</text>`,
    "Illustration: a two-week study calendar ending on exam day");
}

function illoVerify() {
  return svg(480, 120, `
    <rect class="box" x="10" y="30" width="130" height="60" rx="10"/>
    <text class="ink" x="75" y="57" text-anchor="middle">Model draft</text><text x="75" y="75" text-anchor="middle">x = 2, 3</text>
    ${arrow(146, 60, 186, 60, "ln-soft")}
    <rect class="box" x="192" y="30" width="130" height="60" rx="10"/>
    <text class="ink" x="257" y="57" text-anchor="middle">SymPy check</text><text x="257" y="75" text-anchor="middle">solve(x² − 5x + 6)</text>
    ${arrow(328, 60, 368, 60, "ln-soft")}
    <rect class="ok-box" x="374" y="38" width="96" height="44" rx="22"/>
    <path class="ok-ln" d="m392 60 6 6 12-13"/><text class="ok-text" x="420" y="65">Verified</text>`,
    "Diagram: the model drafts an answer, SymPy recomputes it, and matching answers are labelled Verified");
}

const FIGURES = {
  parabola: () => plot({
    fn: (x) => x * x - 5 * x + 6, x: [0, 5], y: [-1, 7],
    points: [{ x: 2, y: 0, label: "x = 2", dx: -16, dy: 18 }, { x: 3, y: 0, label: "x = 3", dx: 16, dy: 18 }],
    curveLabel: { x: 220, y: 54, text: "y = x² − 5x + 6" },
    label: "Graph of y = x² − 5x + 6 crossing the x-axis at x = 2 and x = 3",
  }),
  product: () => plot({
    fn: (x) => x * x * Math.sin(x), x: [-4, 4], y: [-6, 6],
    points: [{ x: 0, y: 0, label: "0", dx: 10, dy: -8 }],
    curveLabel: { x: 40, y: 40, text: "y = x² sin x" },
    label: "Graph of y = x² sin x between x = −4 and 4",
  }),
  eigen,
  kmap2: () => kmap({
    rows: ["A′", "A"], cols: ["B′", "B"], rowVar: "A", colVar: "B",
    values: [["0", "0"], ["1", "1"]], group: 1,
    label: "Two-variable Karnaugh map. The row A has 1 in both cells, so the group simplifies to A",
  }),
  kmap4: () => kmap({
    rows: ["00", "01", "11", "10"], cols: ["00", "01", "11", "10"], rowVar: "AB", colVar: "CD",
    label: "Empty four-variable Karnaugh map with 16 cells in Gray-code order",
  }),
  and: andGate,
  bloch,
  hadamard,
  "illo-tutor": illoTutor,
  "illo-notes": illoNotes,
  "illo-cards": illoCards,
  "illo-roadmap": illoRoadmap,
  "illo-verify": illoVerify,
};

export function figure(name) {
  return FIGURES[name] ? FIGURES[name]() : "";
}

// Fill every <div data-figure="…"> inside `root`.
export function renderFigures(root = document) {
  root.querySelectorAll("[data-figure]").forEach((el) => (el.innerHTML = figure(el.dataset.figure)));
}

/* ---------- Charts (Home) ---------- */
// Single-series charts: one colour, no legend (the card title names the series),
// a tooltip on hover and a hidden table for screen readers.

function chartFrame(data, { w, h, max, unit }) {
  const pad = { l: 34, r: 12, t: 12, b: 26 };
  const iw = w - pad.l - pad.r, ih = h - pad.t - pad.b;
  const sy = (v) => pad.t + ih - (v / max) * ih;
  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    grid += `<line class="grid" x1="${pad.l}" y1="${sy(v)}" x2="${w - pad.r}" y2="${sy(v)}"/>
      <text x="${pad.l - 6}" y="${sy(v) + 4}" text-anchor="end">${Math.round(v)}${unit}</text>`;
  }
  return { pad, iw, ih, sy, grid };
}

function table(data, head) {
  return `<table class="sr-only"><caption>${head[0]}</caption><tr><th>${head[1]}</th><th>${head[2]}</th></tr>
    ${data.map((d) => `<tr><td>${d.label}</td><td>${d.value}</td></tr>`).join("")}</table>`;
}

export function lineChart(data, { w = 420, h = 180, max = 100, unit = "%", title, valueName }) {
  const { pad, iw, sy, grid } = chartFrame(data, { w, h, max, unit });
  const step = iw / (data.length - 1);
  const xs = data.map((_, i) => pad.l + i * step);
  const line = data.map((d, i) => `${i ? "L" : "M"}${f1(xs[i])},${f1(sy(d.value))}`).join("");
  const labels = data.map((d, i) => (i % 2 === data.length % 2 ? "" : `<text x="${xs[i]}" y="${h - 6}" text-anchor="middle">${d.label}</text>`)).join("");
  const last = data.length - 1;
  const dots = data.map((d, i) => `<circle class="chart-dot" data-i="${i}" cx="${xs[i]}" cy="${sy(d.value)}" r="4"/>`).join("");
  const hits = data.map((d, i) => `<rect class="hit" data-i="${i}" x="${xs[i] - step / 2}" y="0" width="${step}" height="${h}"
    data-tip="${d.label}: ${d.value}${unit}"/>`).join("");
  return `<div class="chart" data-chart>
    <svg class="fig" viewBox="0 0 ${w} ${h}" aria-hidden="true">${grid}
      <line class="crosshair" x1="0" y1="${pad.t}" x2="0" y2="${h - pad.b}" visibility="hidden"/>
      <path class="ln" d="${line}"/>${dots}
      <text class="ink" x="${xs[last] - 6}" y="${sy(data[last].value) - 10}" text-anchor="end">${data[last].value}${unit}</text>
      ${labels}${hits}</svg>
    <div class="chart-tip" hidden></div>${table(data, [title, "Quiz", valueName])}</div>`;
}

export function barChart(data, { w = 420, h = 180, max, unit = "", title, valueName }) {
  const { pad, iw, sy, grid } = chartFrame(data, { w, h, max, unit });
  const slot = iw / data.length;
  const bw = Math.min(28, slot - 8);
  const bars = data.map((d, i) => {
    const x = pad.l + i * slot + (slot - bw) / 2, y = sy(d.value), base = sy(0);
    const r = Math.min(4, base - y);
    // Rounded top, square base.
    const path = `M${f1(x)},${f1(base)}V${f1(y + r)}Q${f1(x)},${f1(y)} ${f1(x + r)},${f1(y)}H${f1(x + bw - r)}Q${f1(x + bw)},${f1(y)} ${f1(x + bw)},${f1(y + r)}V${f1(base)}Z`;
    return `<path class="bar${d.today ? " today" : ""}" data-i="${i}" d="${path}"/>
      <text x="${f1(x + bw / 2)}" y="${h - 6}" text-anchor="middle">${d.label}</text>
      <rect class="hit" data-i="${i}" x="${f1(pad.l + i * slot)}" y="0" width="${f1(slot)}" height="${h}" data-tip="${d.label}: ${d.value} ${valueName.toLowerCase()}"/>`;
  }).join("");
  return `<div class="chart" data-chart>
    <svg class="fig" viewBox="0 0 ${w} ${h}" aria-hidden="true">${grid}${bars}</svg>
    <div class="chart-tip" hidden></div>${table(data, [title, "Day", valueName])}</div>`;
}

// Hover layer: a tooltip that follows the pointer, plus a crosshair on line charts.
export function wireCharts(root) {
  root.querySelectorAll("[data-chart]").forEach((chart) => {
    const tip = chart.querySelector(".chart-tip");
    const cross = chart.querySelector(".crosshair");
    const svgEl = chart.querySelector("svg");
    const clear = () => {
      tip.hidden = true;
      if (cross) cross.setAttribute("visibility", "hidden");
      chart.querySelectorAll(".active").forEach((el) => el.classList.remove("active"));
    };
    chart.addEventListener("pointermove", (e) => {
      const hit = e.target.closest(".hit");
      if (!hit) return clear();
      const i = hit.dataset.i;
      chart.querySelectorAll(".active").forEach((el) => el.classList.remove("active"));
      chart.querySelectorAll(`.chart-dot[data-i="${i}"], .bar[data-i="${i}"]`).forEach((el) => el.classList.add("active"));
      const dot = chart.querySelector(`.chart-dot[data-i="${i}"]`);
      if (cross && dot) {
        cross.setAttribute("x1", dot.getAttribute("cx"));
        cross.setAttribute("x2", dot.getAttribute("cx"));
        cross.setAttribute("visibility", "visible");
      }
      const box = chart.getBoundingClientRect();
      const scale = box.width / svgEl.viewBox.baseVal.width;
      const hb = hit.getBBox();
      tip.textContent = hit.dataset.tip;
      tip.hidden = false;
      tip.style.left = `${Math.min(box.width - tip.offsetWidth, Math.max(0, (hb.x + hb.width / 2) * scale - tip.offsetWidth / 2))}px`;
    });
    chart.addEventListener("pointerleave", clear);
  });
}

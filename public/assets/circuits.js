// Logic circuit diagrams for EduGuardian answers.
// The model writes a ```logic block with one Boolean equation per line, e.g.
//   Y = (NOT S AND D0) OR (S AND D1)
//   Y = MUX(S, D0, D1)
// and this file turns each line into an SVG drawing with real gate symbols.
// Colours come from CSS classes (".fig …"), so it follows the dark/bright theme.

/* ---------- 1. Reading the equation ---------- */

// Words and symbols the model may use for each gate
const OPS = {
  OR: ["OR", "+", "|", "||", "∨"],
  NOR: ["NOR"],
  XOR: ["XOR", "^", "⊕"],
  XNOR: ["XNOR", "⊙"],
  AND: ["AND", "&", "&&", "*", "·", "•", "∧", "."],
  NAND: ["NAND"],
};
const NOT_PREFIX = ["NOT", "!", "~", "¬"];
const NOT_POSTFIX = ["'", "’", "′"];
const GATES = ["AND", "OR", "NOT", "NAND", "NOR", "XOR", "XNOR", "BUF", "MUX"];
const opOf = (tok) => Object.keys(OPS).find((k) => OPS[k].includes(tok.toUpperCase()));

function tokenize(src) {
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|[01]|&&|\|\||[()+|^⊕⊙&*·•∧∨.!~¬'’′,=])/y;
  const out = [];
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(re.lastIndex))) break;
    m = re.exec(src);
    if (!m) throw new Error(`Can't read "${src.slice(re.lastIndex)}"`);
    out.push(m[1]);
  }
  return out;
}

// Turns tokens into a tree: { g: "AND", in: [...] } or { v: "A" }.
// Order of strength (weakest first): OR/NOR, XOR/XNOR, AND/NAND, NOT.
function parse(tokens) {
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (t) => { if (next() !== t) throw new Error(`Expected "${t}"`); };

  const level = (ops, sub) => () => {
    let left = sub();
    for (;;) {
      const t = peek();
      const op = t && opOf(t);
      if (!op || !ops.includes(op)) {
        // "A B" next to each other (with a space) means A AND B
        if (ops.includes("AND") && t && t !== ")" && t !== "," && !opOf(t) && !NOT_POSTFIX.includes(t)) {
          left = join("AND", left, sub());
          continue;
        }
        return left;
      }
      next();
      left = join(op, left, sub());
    }
  };
  // A AND B AND C becomes one 3-input gate instead of two 2-input gates
  const join = (op, a, b) => {
    if (["AND", "OR", "XOR"].includes(op) && a.g === op) return { g: op, in: [...a.in, b] };
    return { g: op, in: [a, b] };
  };

  const factor = () => {
    let t = next();
    if (t === undefined) throw new Error("The equation ends too early");
    let node;
    const up = t.toUpperCase();
    if (NOT_PREFIX.includes(up) && !(up === "NOT" && peek() === "(")) {
      node = { g: "NOT", in: [factor()] };
    } else if (t === "(") {
      node = orLevel();
      expect(")");
    } else if (GATES.includes(up) && peek() === "(") {
      // Function style: AND(A, B, C) or MUX(S, D0, D1)
      next();
      const args = [orLevel()];
      while (peek() === ",") { next(); args.push(orLevel()); }
      expect(")");
      node = { g: up, in: args };
      if (node.g === "MUX" && args.length < 3) throw new Error("MUX needs a select line and at least two inputs");
      if ((node.g === "NOT" || node.g === "BUF") && args.length !== 1) throw new Error("NOT takes one input");
    } else if (/^[A-Za-z_0-9]/.test(t) && !opOf(t)) {
      node = { v: t };
    } else {
      throw new Error(`Unexpected "${t}"`);
    }
    while (peek() && NOT_POSTFIX.includes(peek())) { next(); node = { g: "NOT", in: [node] }; }
    return node;
  };

  const andLevel = level(["AND", "NAND"], factor);
  const xorLevel = level(["XOR", "XNOR"], andLevel);
  const orLevel = level(["OR", "NOR"], xorLevel);

  const tree = orLevel();
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}"`);
  return tree;
}

// NOT (A AND B) is drawn as one NAND gate, and so on
function tidy(n) {
  if (n.v) return n;
  n.in = n.in.map(tidy);
  const inner = n.in[0];
  const merge = { AND: "NAND", OR: "NOR", XOR: "XNOR" };
  if (n.g === "NOT" && inner.g && merge[inner.g]) return { g: merge[inner.g], in: inner.in };
  return n;
}

export function parseLine(line) {
  const eq = line.indexOf("=");
  const name = eq > 0 ? line.slice(0, eq).trim() : "Y";
  const body = eq > 0 ? line.slice(eq + 1) : line;
  if (!/^[A-Za-z_][\w ()]*$/.test(name)) throw new Error("Bad output name");
  return { name, tree: tidy(parse(tokenize(body))) };
}

/* ---------- 2. Drawing it ---------- */

const ROW = 40; // height of one input row
const COL = 96; // distance between gate columns
const PAD = 14;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const r1 = (n) => Math.round(n * 10) / 10;

const depth = (n) => (n.v ? 0 : 1 + Math.max(...n.in.map(depth)));

// Gate shapes. Each gets the left edge x, the centre y and the height h,
// and returns the SVG plus where the output wire starts.
function shape(g, x, y, h, n) {
  const t = y - h / 2, b = y + h / 2;
  const bubble = (ox) => `<circle class="gate" cx="${r1(ox + 4.5)}" cy="${r1(y)}" r="4.5"/>`;
  const negated = ["NAND", "NOR", "XNOR", "NOT"].includes(g);
  let body, out;
  if (g === "AND" || g === "NAND") {
    const flat = 20;
    body = `<path class="gate" d="M${x} ${r1(t)} H${x + flat} A${r1(h / 2)} ${r1(h / 2)} 0 0 1 ${x + flat} ${r1(b)} H${x} Z"/>`;
    out = x + flat + h / 2;
  } else if (g === "OR" || g === "NOR" || g === "XOR" || g === "XNOR") {
    const w = Math.max(46, h * 0.75);
    const x0 = g.startsWith("X") ? x + 7 : x;
    body = `<path class="gate" d="M${x0} ${r1(t)} Q${r1(x0 + w * 0.55)} ${r1(t)} ${r1(x0 + w)} ${r1(y)} Q${r1(x0 + w * 0.55)} ${r1(b)} ${x0} ${r1(b)} Q${r1(x0 + w * 0.28)} ${r1(y)} ${x0} ${r1(t)} Z"/>`;
    if (g.startsWith("X")) body += `<path class="gate-line" d="M${x} ${r1(t)} Q${r1(x + w * 0.28)} ${r1(y)} ${x} ${r1(b)}"/>`;
    out = x0 + w;
  } else if (g === "NOT" || g === "BUF") {
    body = `<path class="gate" d="M${x} ${r1(y - 13)} L${x + 26} ${r1(y)} L${x} ${r1(y + 13)} Z"/>`;
    out = x + 26;
  } else if (g === "MUX") {
    const w = 40;
    body = `<path class="gate" d="M${x} ${r1(t)} L${x + w} ${r1(t + 12)} L${x + w} ${r1(b - 12)} L${x} ${r1(b)} Z"/>`;
    body += `<text class="ink small-t" x="${x + w / 2}" y="${r1(y + 4)}" text-anchor="middle">MUX</text>`;
    out = x + w;
  }
  if (negated) { body += bubble(out); out += 9; }
  return { body, out };
}

// Lays out one equation. Inputs sit in rows on the left, gates in columns
// by how deep they are, and wires bend once near the gate they feed.
function drawTree(name, tree) {
  const labels = [];
  const collect = (n) => (n.v ? labels.push(n.v) : n.in.forEach(collect));
  collect(tree);
  const labelW = Math.max(...labels.map((l) => l.length)) * 8 + 16;
  const gateX = (d) => PAD + labelW + 22 + (d - 1) * COL;

  let row = 0;
  let wires = "", gates = "", texts = "";

  // Draws a wire from (x1, y1) to (x2, y2): across, down/up, across.
  const wire = (x1, y1, x2, y2, bendX) => {
    if (Math.abs(y1 - y2) < 0.5) return `<path class="wire" d="M${r1(x1)} ${r1(y1)} H${r1(x2)}"/>`;
    return `<path class="wire" d="M${r1(x1)} ${r1(y1)} H${r1(bendX)} V${r1(y2)} H${r1(x2)}"/>`;
  };

  // Returns { x, y } of the node's output.
  const place = (n) => {
    if (n.v) {
      const y = PAD + row++ * ROW + ROW / 2;
      texts += `<text class="ink" x="${PAD + labelW - 8}" y="${r1(y + 4)}" text-anchor="end">${esc(n.v)}</text>`;
      return { x: PAD + labelW - 2, y };
    }
    const data = n.g === "MUX" ? n.in.slice(1) : n.in;
    const kids = data.map(place);
    const sel = n.g === "MUX" ? place(n.in[0]) : null;
    const y = kids.reduce((s, k) => s + k.y, 0) / kids.length;
    const k = kids.length;
    const gap = n.g === "MUX" ? 22 : 16;
    const h = n.g === "NOT" || n.g === "BUF" ? 26 : Math.max(34, (k - 1) * gap + 22);
    const x = gateX(depth(n));
    const { body, out } = shape(n.g, x, y, h, k);
    gates += body;
    // Where each input wire meets the gate
    kids.forEach((c, i) => {
      const py = k === 1 ? y : y - ((k - 1) * gap) / 2 + i * gap;
      const bend = x - 10 - (k > 1 ? Math.abs(i - (k - 1) / 2) * 7 : 0);
      wires += wire(c.x, c.y, x + (n.g.includes("OR") ? 8 : 0), py, Math.max(c.x + 6, bend));
      if (n.g === "MUX") texts += `<text class="small-t" x="${x + 5}" y="${r1(py + 3.5)}">${i}</text>`;
    });
    if (sel) {
      // The select line comes up into the bottom of the MUX
      const sx = x + 20, sy = y + h / 2 - 6;
      wires += `<path class="wire" d="M${r1(sel.x)} ${r1(sel.y)} H${sx} V${r1(sy)}"/>`;
    }
    return { x: out, y };
  };

  const top = place(tree);
  const h = Math.max(row * ROW + PAD * 2, top.y + 30);
  const endX = top.x + 34;
  wires += `<path class="ln" d="M${r1(top.x)} ${r1(top.y)} H${r1(endX)}"/><circle class="dot" cx="${r1(endX)}" cy="${r1(top.y)}" r="4"/>`;
  texts += `<text class="hl-text" x="${r1(endX + 9)}" y="${r1(top.y + 4)}">${esc(name)}</text>`;
  const width = endX + 12 + name.length * 8 + PAD;
  return `<svg class="fig circuit" viewBox="0 0 ${r1(width)} ${r1(h)}" style="max-width:${r1(width * 1.25)}px" role="img" aria-label="Logic circuit for ${esc(name)}">${wires}${gates}${texts}</svg>`;
}

// Turns the text of a ```logic block into SVG drawings, or returns null if
// a line can't be read (then the plain text stays on screen).
export function circuitSvg(src) {
  const lines = src.split("\n").map((l) => l.replace(/(#|\/\/).*$/, "").trim()).filter(Boolean);
  if (!lines.length) return null;
  try {
    return lines.map((l) => { const { name, tree } = parseLine(l); return drawTree(name, tree); }).join("");
  } catch (e) {
    return null;
  }
}

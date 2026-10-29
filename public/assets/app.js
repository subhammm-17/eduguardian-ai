// EduGuardian AI workspace.
// Screens: Home, Ask (Normal + Socratic), Study (Flashcards + Quiz), plus
// Syllabus and Roadmap previews.
// Sign-in, Ask, hints and graphs use the FastAPI backend (through api.js).
// Syllabus uploads are saved by the backend too. Today's plan is saved in this browser.
// The rest of Home, Study and Roadmap still use sample data from fixtures.js.
// Parental controls: a linked parent can turn on hint mode (checked by the server),
// and roadmap progress is sent to the backend so the parent dashboard can show it.
import * as api from "./api.js?v=14";
import {
  SUBJECTS, MODELS, DASHBOARD, TODAY_TASKS, RECENT_QUESTIONS, SUGGESTIONS,
  HINT_LABELS, DECKS, QUIZ_BANK,
  QUIZ_HISTORY, REVIEWS_WEEK, PROMPT_TEMPLATES, QUIZ_TEMPLATES, ROADMAP_TEMPLATES,
} from "./fixtures.js?v=14";
import { figure, answerFigure, lineChart, barChart, wireCharts } from "./figures.js?v=14";
import { circuitSvg } from "./circuits.js?v=14";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

const state = {
  subject: "maths",
  model: "gemini",
  mode: "normal",
  history: [], // { role: "user" | "ai", text } — the last few are sent with each question
  hintLevel: 0,
  busy: false,
  hintLocked: false, // true when a parent turned on hint mode
};

/* ---------- Helpers ---------- */

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Callout boxes. In Markdown, a quote that starts with a type in [!brackets]
// becomes a labelled box, for example "> [!tip] Check by substitution."
const CALLOUTS = {
  definition: { label: "Definition", icon: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19a2 2 0 0 1 2-2h13"/>' },
  formula: { label: "Formula", icon: '<path d="M18 5H7l6 7-6 7h11"/>' },
  example: { label: "Example", icon: '<path d="m5 12 5 5 9-10"/>' },
  tip: { label: "Tip", icon: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>' },
  mistake: { label: "Common mistake", icon: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/>' },
};

function callouts(html) {
  if (!html.includes("[!")) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("blockquote").forEach((bq) => {
    const p = bq.querySelector("p");
    const m = p?.innerHTML.match(/^\s*\[!(\w+)\]\s*/);
    const type = m && CALLOUTS[m[1].toLowerCase()] ? m[1].toLowerCase() : null;
    if (!type) return;
    p.innerHTML = p.innerHTML.slice(m[0].length);
    if (!p.textContent.trim()) p.remove();
    const box = document.createElement("aside");
    box.className = `callout callout-${type}`;
    const { label, icon } = CALLOUTS[type];
    box.innerHTML = `<div class="callout-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg>${label}</div>${bq.innerHTML}`;
    bq.replaceWith(box);
  });
  return tpl.innerHTML;
}

// A diagram from figures.js with a caption, shown under an answer.
function diagram(name, caption = "") {
  const svgHtml = figure(name);
  if (!svgHtml) return "";
  return `<figure class="diagram">${svgHtml}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
}

// Render Markdown with maths. Models write maths in several ways, so we accept
// $…$, $$…$$, \(…\), \[…\] and bare \begin{aligned}…\end{aligned} blocks.
// Maths is pulled out before Markdown parsing so backslashes survive, then
// rendered with KaTeX after sanitising. Code (`…` and ``` blocks) is left alone.
const MATH_RE = new RegExp([
  /(?<code>```[\s\S]*?```|`[^`\n]+`)/.source,
  /\$\$(?<dd>[\s\S]+?)\$\$/.source,
  /\\\[(?<db>[\s\S]+?)\\\]/.source,
  /\\begin\{(?<env>align\*?|aligned|equation\*?|gather\*?|cases|[pbv]?matrix)\}[\s\S]*?\\end\{\k<env>\}/.source,
  /\\\((?<ib>[\s\S]+?)\\\)/.source,
  // $x$ but not prices like "$5 and $10" or an escaped \$
  /(?<!\\)\$(?=\S)(?<id>[^$\n]*?\S)(?<!\\)\$(?!\d)/.source,
].join("|"), "g");

// While an answer is still streaming, maths that has started but not finished
// (an opening $$ or \[ with no closing one yet) is hidden until it is complete.
function cutUnfinishedMath(text) {
  const open = text.search(/\$\$|\\\[|\\\(|\\begin\{|(?<!\\)\$(?=[^\s\d])[^$\n]*$/);
  return open === -1 ? text : text.slice(0, open) + " …";
}

function rich(md, inline = false, streaming = false) {
  if (!window.marked || !window.DOMPurify) return escapeHtml(md);
  const math = [];
  const stash = (t, display) => { math.push({ t: t.trim(), display }); return `@@M${math.length - 1}@@`; };
  let text = String(md ?? "").replace(MATH_RE, (whole, ...args) => {
    const g = args.at(-1);
    if (g.code) return whole;
    if (g.env) return stash(whole, true);
    if (g.dd !== undefined || g.db !== undefined) return stash(g.dd ?? g.db, true);
    return stash(g.ib ?? g.id, false);
  });
  if (streaming) text = cutUnfinishedMath(text);
  if (streaming) text = cutUnfinishedDiagram(text);
  let html = inline ? marked.parseInline(text) : marked.parse(text);
  html = callouts(DOMPurify.sanitize(html));
  if (!inline) html = tablesAndDiagrams(html);
  return html.replace(/@@M(\d+)@@/g, (_, i) => {
    const m = math[i];
    if (!window.katex) return escapeHtml(m.t);
    return katex.renderToString(m.t, { displayMode: m.display && !inline, throwOnError: false });
  });
}

/* ---------- Tables and diagrams in answers ---------- */

// While streaming, a ```logic, ```figure or ```mermaid block that isn't finished yet is
// shown as "Drawing diagram…" instead of half-written code.
function cutUnfinishedDiagram(text) {
  const fences = [...text.matchAll(/^ {0,3}```(\w*)/gm)];
  if (fences.length % 2 === 0) return text;
  const last = fences.at(-1);
  if (!["logic", "mermaid", "figure"].includes(last[1])) return text;
  return text.slice(0, last.index) + "\n\n*Drawing diagram…*";
}

// Wide tables scroll sideways on phones, ```logic blocks become circuit
// drawings, ```figure blocks become our own SVG figures (like the Bloch sphere),
// and ```mermaid blocks wait for drawMermaid() (they need a library).
function tablesAndDiagrams(html) {
  if (!/<table|<pre/.test(html)) return html;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  tpl.content.querySelectorAll("table").forEach((t) => {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    t.replaceWith(wrap);
    wrap.append(t);
  });
  tpl.content.querySelectorAll("pre > code.language-logic").forEach((code) => {
    const svgHtml = circuitSvg(code.textContent);
    if (!svgHtml) return; // couldn't read it: keep the text
    const fig = document.createElement("figure");
    fig.className = "diagram circuit-box";
    fig.innerHTML = svgHtml; // built by circuits.js, which escapes every name
    code.parentElement.replaceWith(fig);
  });
  tpl.content.querySelectorAll("pre > code.language-figure").forEach((code) => {
    const svgHtml = answerFigure(code.textContent);
    if (!svgHtml) return; // not a figure we know: keep the text
    const fig = document.createElement("figure");
    fig.className = "diagram figure-box";
    fig.innerHTML = svgHtml; // built by figures.js, which escapes the label
    code.parentElement.replaceWith(fig);
  });
  // The model sometimes forgets to write "mermaid" after the ```, so any code
  // block that starts like a flowchart (graph TD, flowchart LR, ...) counts too.
  const isMermaid = (code) => code.classList.contains("language-mermaid") ||
    (!/language-(logic|figure)/.test(code.className) && /^\s*(graph|flowchart)\s+(TD|TB|BT|LR|RL)\b/.test(code.textContent));
  [...tpl.content.querySelectorAll("pre > code")].filter(isMermaid).forEach((code) => {
    // Mermaid can't draw a 3-D sphere, so a "Bloch sphere" flowchart becomes our real drawing
    if (looksLikeBloch(code.textContent)) {
      const fig = document.createElement("figure");
      fig.className = "diagram figure-box";
      fig.innerHTML = answerFigure("bloch");
      code.parentElement.replaceWith(fig);
      return;
    }
    const fig = document.createElement("figure");
    fig.className = "diagram mermaid-box";
    fig.dataset.src = code.textContent;
    fig.innerHTML = `<p class="muted small">Drawing diagram…</p>`;
    code.parentElement.replaceWith(fig);
  });
  return tpl.innerHTML;
}

// A Mermaid block that tries to show the Bloch sphere (its axes and |0⟩ / |1⟩)
function looksLikeBloch(src) {
  if (/bloch/i.test(src)) return true;
  const axes = (src.match(/\b[XYZ][- ]?axis/gi) || []).length;
  return axes >= 2 && /\|0⟩|\|1⟩|θ|theta/i.test(src);
}

// Mermaid often fails on labels with brackets or | inside, like A[Z-axis (|0⟩)].
// Putting every [label] in quotes fixes most of them, so we try that second.
function quoteMermaidLabels(src) {
  return src.replace(/(\b\w+)\[(?!")([^\]\n]+)\]/g, (_, id, label) => `${id}["${label.replace(/"/g, "'")}"]`);
}

// Mermaid (flowcharts, block diagrams, state diagrams) is a big library, so it
// is only downloaded the first time an answer has a ```mermaid block.
const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
let mermaidLib = null;
let mermaidCount = 0;

// Mermaid needs real colours, so read them from the current theme's tokens.
function mermaidTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: "IBM Plex Sans, sans-serif",
    themeVariables: {
      background: v("--surface"),
      primaryColor: v("--accent-weak"),
      primaryBorderColor: v("--accent-bright"),
      primaryTextColor: v("--text"),
      secondaryColor: v("--surface-2"),
      tertiaryColor: v("--surface-2"),
      lineColor: v("--muted"),
      textColor: v("--text"),
      mainBkg: v("--surface-2"),
      nodeBorder: v("--border-strong"),
      clusterBkg: v("--surface"),
      edgeLabelBackground: v("--surface"),
    },
  };
}

async function drawMermaid(root = document) {
  const boxes = [...root.querySelectorAll(".mermaid-box[data-src]")];
  if (!boxes.length) return;
  try {
    mermaidLib ??= (await import(MERMAID_URL)).default;
  } catch (e) {
    boxes.forEach(showDiagramText);
    return;
  }
  mermaidLib.initialize(mermaidTheme());
  for (const box of boxes) {
    let svg = null;
    for (const src of [box.dataset.src, quoteMermaidLabels(box.dataset.src)]) {
      try {
        ({ svg } = await mermaidLib.render(`mmd-${++mermaidCount}`, src));
        break;
      } catch (e) {
        document.getElementById(`dmmd-${mermaidCount}`)?.remove(); // Mermaid leaves an error box behind
      }
    }
    if (!svg) { showDiagramText(box); continue; } // the model wrote something Mermaid can't read
    box.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
    box.querySelector("svg")?.classList.add("mermaid-svg");
  }
}

// Fallback: say the diagram couldn't be drawn, and keep its text folded away
function showDiagramText(box) {
  const details = document.createElement("details");
  details.className = "diagram-fallback";
  const summary = document.createElement("summary");
  summary.textContent = "This diagram couldn't be drawn. Show its text";
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.textContent = box.dataset.src;
  pre.append(code);
  details.append(summary, pre);
  box.replaceWith(details);
}

// Redraw Mermaid diagrams when the bright/dark theme changes
new MutationObserver(() => mermaidLib && drawMermaid()).observe(document.documentElement, {
  attributes: true, attributeFilter: ["data-theme"],
});

function toast(message, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 3500);
}

const subjectName = (id) => SUBJECTS.find((s) => s.id === id)?.name ?? id;
// Turns the model name the backend reports (e.g. "gemini-3.8-flash") into a short label
function modelLabel(answeredBy) {
  if (!answeredBy) return MODELS.find((m) => m.id === state.model)?.label ?? "Gemini";
  const provider = answeredBy.startsWith("gemini") ? "Gemini" : "Groq";
  return `${provider} (${answeredBy})`;
}

/* ---------- Top bar ---------- */

function initTopbar() {
  $("#subject").innerHTML = SUBJECTS.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
  $("#model").innerHTML = MODELS.map((m) => `<option value="${m.id}">${m.label} · ${m.backup} as backup</option>`).join("");

  $("#subject").addEventListener("change", (e) => {
    state.subject = e.target.value;
    renderSuggestions();
    resetHints();
  });
  $("#model").addEventListener("change", (e) => (state.model = e.target.value));

  const user = api.getUser() || { name: "Student", email: "" };
  $("#user-name").textContent = user.name;
  $("#user-email").textContent = user.email;
  $("#user-initials").textContent = user.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  state.user = user;

  const btn = $("#user-btn");
  const pop = $("#user-pop");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.setAttribute("aria-expanded", String(!pop.hidden));
    if (!pop.hidden) $(".popover-item", pop).focus();
  });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target)) close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { close(); btn.focus(); } });
  $("#logout").addEventListener("click", async () => {
    await api.logout();
    location.href = "/login.html";
  });
}

/* ---------- Routing ---------- */

const TITLES = { home: "Home", ask: "Ask", syllabus: "Syllabus", study: "Study", roadmap: "Roadmap" };

function route(focus = true) {
  const view = (location.hash.slice(1) || "home").split("?")[0];
  const name = TITLES[view] ? view : "home";
  $$("[data-view]").forEach((s) => (s.hidden = s.dataset.view !== name));
  $$("[data-nav]").forEach((a) => (a.dataset.nav === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  $("#view-title").textContent = TITLES[name];
  document.title = `${TITLES[name]} — EduGuardian AI`;
  if (name === "home") renderHome();
  if (focus) $("#view").focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

/* ---------- Home ---------- */

function renderHome() {
  const h = new Date().getHours();
  const part = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  $("#greeting").textContent = `Good ${part}, ${state.user.name.split(" ")[0]}`;

  $("#stat-due").textContent = DASHBOARD.cardsDue;
  const q = DASHBOARD.lastQuiz;
  $("#stat-quiz").textContent = `${q.score}/${q.total}`;
  $("#stat-quiz-meta").textContent = `${q.topic} · ${q.when}`;
  const r = roadmap ? roadmapStats() : DASHBOARD.roadmap;
  $("#stat-road").textContent = `${r.progress}%`;
  $("#stat-road-bar").style.width = `${r.progress}%`;
  $("#stat-road-meta").textContent = `${r.exam} · exam on ${r.examDate}`;

  renderTasks();

  renderCharts();

  $("#recent").innerHTML = RECENT_QUESTIONS.map((q) => `
    <li><span class="q">${escapeHtml(q.text)}</span><span class="muted small">${q.subject} · ${q.when}</span></li>`).join("");
}

function renderCharts() {
  const recent = QUIZ_HISTORY.slice(-8);
  $("#chart-quiz").innerHTML = lineChart(recent, { title: "Quiz scores", valueName: "Score" });
  const total = REVIEWS_WEEK.reduce((n, d) => n + d.value, 0);
  const max = Math.max(10, Math.ceil(Math.max(...REVIEWS_WEEK.map((d) => d.value)) / 10) * 10);
  $("#chart-reviews").innerHTML = barChart(REVIEWS_WEEK, { max, title: "Cards reviewed", valueName: "Cards" });
  $("#chart-reviews-meta").textContent = `${total} in the last 7 days`;
  wireCharts($('[data-view="home"]'));
}

/* ---------- Home: today's plan ---------- */

// Your tasks are saved in this browser (localStorage), so added and deleted
// tasks are still there after a refresh. The first time, the sample tasks are used.
const TASKS_KEY = "eduguardian_tasks";
let tasks = loadTasks();

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(TASKS_KEY));
    if (Array.isArray(saved)) return saved;
  } catch (e) {}
  return TODAY_TASKS.map((t) => ({ ...t }));
}

function saveTasks() {
  try { localStorage.setItem(TASKS_KEY, JSON.stringify(tasks)); } catch (e) {}
}

// Also used by the Roadmap's "+ Today" buttons
function addTask(title, minutes = 30) {
  tasks.push({ id: `t${Date.now()}${Math.floor(Math.random() * 1000)}`, title, minutes, done: false });
  saveTasks();
  renderTasks();
}

const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function renderTasks() {
  const list = $("#today-tasks");
  list.innerHTML = tasks.length ? tasks.map((t) => `
    <li class="${t.done ? "done" : ""}">
      <input type="checkbox" id="task-${escapeHtml(t.id)}" data-task="${escapeHtml(t.id)}" ${t.done ? "checked" : ""} />
      <label for="task-${escapeHtml(t.id)}">${escapeHtml(t.title)}</label>
      <span class="task-meta">${escapeHtml(t.minutes)} min</span>
      <button type="button" class="task-del" data-del="${escapeHtml(t.id)}" aria-label="Delete task: ${escapeHtml(t.title)}" title="Delete task">${ICON_X}</button>
    </li>`).join("") : '<li class="task-empty muted small">No tasks yet. Use Edit plan → Add a task.</li>';
  updateTaskCount();
}

function updateTaskCount() {
  const done = tasks.filter((t) => t.done).length;
  $("#today-count").textContent = tasks.length ? `${done} of ${tasks.length} done` : "";
}

function initHome() {
  const list = $("#today-tasks");
  const form = $("#task-add");
  list.addEventListener("change", (e) => {
    const task = tasks.find((t) => t.id === e.target.dataset.task);
    if (!task) return;
    task.done = e.target.checked;
    e.target.closest("li").classList.toggle("done", task.done);
    saveTasks();
    updateTaskCount();
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-del]");
    if (!b) return;
    tasks = tasks.filter((t) => t.id !== b.dataset.del);
    saveTasks();
    renderTasks();
    if (!tasks.length) setDeleting(false);
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const title = $("#task-title").value.trim();
    if (!title) return;
    const minutes = Math.min(600, Math.max(5, Math.round(Number($("#task-minutes").value) || 30)));
    addTask(title, minutes);
    $("#task-title").value = "";
    $("#task-title").focus();
  });
  $("#task-add-close").addEventListener("click", () => { form.hidden = true; });

  // "Edit plan" drop-down menu: add a task, delete tasks, remove finished ones
  const btn = $("#plan-menu-btn");
  const pop = $("#plan-pop");
  const close = () => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const setDeleting = (on) => {
    list.classList.toggle("deleting", on);
    $('[data-plan-action="delete"]').textContent = on ? "Stop deleting" : "Delete tasks";
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.setAttribute("aria-expanded", String(!pop.hidden));
    if (!pop.hidden) $(".popover-item", pop).focus();
  });
  document.addEventListener("click", (e) => { if (!pop.contains(e.target)) close(); });
  pop.addEventListener("keydown", (e) => { if (e.key === "Escape") { close(); btn.focus(); } });
  pop.addEventListener("click", (e) => {
    const action = e.target.closest("[data-plan-action]")?.dataset.planAction;
    if (!action) return;
    close();
    if (action === "add") {
      form.hidden = false;
      $("#task-title").focus();
    } else if (action === "delete") {
      setDeleting(!list.classList.contains("deleting"));
    } else if (action === "clear-done") {
      const before = tasks.length;
      tasks = tasks.filter((t) => !t.done);
      saveTasks();
      renderTasks();
      toast(before === tasks.length ? "No finished tasks to remove" : `Removed ${before - tasks.length} finished ${before - tasks.length === 1 ? "task" : "tasks"}`);
    }
  });

  // The ask bar at the bottom of Home: opens Ask and sends the question there
  $("#quick-ask").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = $("#quick-q").value.trim();
    if (!text) return $("#quick-q").focus();
    $("#quick-q").value = "";
    location.hash = "#ask";
    ask(text);
  });
}

/* ---------- Ask ---------- */

const MODE_DESC = {
  normal: "Full explanations with worked solutions.",
  socratic: "Guiding questions and hints. The final answer is never given.",
  guided: "Your parent turned on hint mode: you get the idea, hints and partial steps, and you finish the last step.",
};

function renderSuggestions() {
  $("#suggestions").innerHTML = SUGGESTIONS[state.subject]
    .map((s) => `<button type="button" class="btn suggestion">${escapeHtml(s)}</button>`).join("");
}

function setMode(mode) {
  state.mode = mode;
  $$("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  // In hint mode the "Normal" button becomes "Hint mode": the server never sends full answers
  const guided = state.hintLocked && mode === "normal";
  $('[data-mode="normal"]').textContent = state.hintLocked ? "Hint mode" : "Normal";
  $("#hint-lock").hidden = !state.hintLocked;
  $("#mode-desc").textContent = MODE_DESC[guided ? "guided" : mode];
  $("#hints").hidden = mode !== "socratic";
  $("#question").placeholder = mode === "socratic" ? "Describe the problem or share your reasoning…" : "Ask a question…";
}

function resetHints() {
  state.hintLevel = 0;
  $$("[data-hint]").forEach((b, i) => (b.disabled = i !== 0));
}

function addUserMessage(text) {
  const el = document.createElement("div");
  el.className = "msg msg-user";
  el.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
  $("#thread").append(el);
}

function metaBadges({ socratic, guided, verified, by }) {
  let html = `<span class="badge">${subjectName(state.subject)}</span>`;
  if (socratic) html += `<span class="badge badge-accent">Socratic</span>`;
  if (guided) html += `<span class="badge badge-warn" title="Set by your parent">Hint mode</span>`;
  if (verified) html += `<span class="badge badge-success" title="Result checked with the SymPy solver">${ICON_CHECK}Verified</span>`;
  return html + `<span class="by">Answered by ${escapeHtml(modelLabel(by))}</span>`;
}

// The login expired or was removed: go back to the sign-in page.
function backToLogin() {
  api.clearLogin();
  location.href = "/login.html";
}

// The last few messages, in the shape the backend expects
function recentHistory() {
  return state.history.slice(-6).map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.text }));
}

// Draws a graph under a maths answer when the question has something to plot.
async function addPlot(msg, question) {
  try {
    const data = await api.getPlot(question);
    if (!data.image) return; // nothing to draw, e.g. "What is a matrix?"
    const fig = document.createElement("figure");
    fig.className = "diagram";
    const img = document.createElement("img");
    img.className = "plot";
    img.src = `data:image/png;base64,${data.image}`;
    img.alt = data.caption || "Graph for this question";
    fig.append(img);
    if (data.caption) {
      const cap = document.createElement("figcaption");
      cap.textContent = data.caption;
      fig.append(cap);
    }
    msg.append(fig);
  } catch (e) {
    // A missing graph is not worth an error message
  }
}

// Questions about the Bloch sphere always get the drawing, even when the
// model forgot to write a ```figure block (or wrote plain text instead).
function addBlochIfMissing(prose, question, answer) {
  if (prose.querySelector(".figure-box")) return;
  if (!/bloch/i.test(question) && !/bloch/i.test(answer || "")) return;
  const fig = document.createElement("figure");
  fig.className = "diagram figure-box";
  fig.innerHTML = answerFigure("bloch") + `<figcaption>The Bloch sphere: |0⟩ at the top, |1⟩ at the bottom, and a state |ψ⟩ at angles θ and φ.</figcaption>`;
  prose.append(fig);
}

async function ask(text) {
  if (state.busy || !text.trim()) return;
  state.busy = true;
  $("#send").disabled = true;
  $("#ask-empty")?.remove();
  $("#clear-chat").hidden = false;

  addUserMessage(text);
  const history = recentHistory(); // earlier messages only, not this question
  state.history.push({ role: "user", text });

  const socratic = state.mode === "socratic";
  const subject = state.subject;
  const msg = document.createElement("div");
  msg.className = "msg msg-ai";
  msg.innerHTML = `<div class="typing" aria-label="Generating answer"><div class="skeleton" style="width:92%"></div><div class="skeleton" style="width:78%"></div><div class="skeleton" style="width:55%"></div></div>`;
  $("#thread").append(msg);
  msg.scrollIntoView({ block: "nearest", behavior: "smooth" });

  let prose = null;
  try {
    const { text: answer, answeredBy, mode } = await api.askStream(
      { subject, question: text, mode: state.mode, primary: state.model, history },
      (soFar) => {
        // First words arrived: swap the skeleton for the answer area
        if (!prose) {
          msg.innerHTML = `<div class="msg-meta"></div><div class="prose caret"></div>`;
          prose = $(".prose", msg);
        }
        prose.innerHTML = rich(soFar, false, true);
      },
    );
    if (!prose) {
      msg.innerHTML = `<div class="msg-meta"></div><div class="prose"></div>`;
      prose = $(".prose", msg);
    }
    prose.classList.remove("caret");
    prose.innerHTML = rich(answer || "*(The model sent an empty answer. Please try again.)*");
    drawMermaid(prose);
    // Verified stays off until answer checking with SymPy is added (PLAN.md, milestone 4).
    // The server says "guided" when a parent turned on hint mode (even if this page didn't know yet)
    const guided = mode === "guided";
    if (guided && !state.hintLocked) { state.hintLocked = true; setMode(state.mode); }
    $(".msg-meta", msg).innerHTML = metaBadges({ socratic, guided, verified: false, by: answeredBy });
    state.history.push({ role: "ai", text: answer, socratic: socratic || guided });
    // Graphs appear only in Normal mode, where giving the answer is allowed.
    if (!socratic && !guided && subject === "maths") await addPlot(msg, text);
    if (subject === "quantum") addBlochIfMissing(prose, text, answer);
  } catch (err) {
    if (err.status === 401) return backToLogin();
    msg.innerHTML = `<div class="msg-meta"><span class="badge">Error</span></div><div class="prose"><p>${escapeHtml(err.message)}</p></div>`;
    state.history.pop(); // forget the question that got no answer
    toast(err.message, "error");
  } finally {
    state.busy = false;
    $("#send").disabled = false;
    msg.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

// Hints work on the latest question, or on what is typed in the box right now.
async function showHint(level) {
  const lastQuestion = [...state.history].reverse().find((m) => m.role === "user")?.text;
  const question = lastQuestion || $("#question").value.trim();
  if (!question) {
    toast("Type your problem first, then ask for a hint.");
    return $("#question").focus();
  }
  if (state.busy) return;
  state.busy = true;
  $$("[data-hint]").forEach((b) => (b.disabled = true));

  const msg = document.createElement("div");
  msg.className = "msg msg-ai";
  msg.innerHTML = `<div class="typing" aria-label="Writing hint"><div class="skeleton" style="width:80%"></div><div class="skeleton" style="width:50%"></div></div>`;
  $("#ask-empty")?.remove();
  $("#clear-chat").hidden = false;
  $("#thread").append(msg);
  msg.scrollIntoView({ block: "nearest", behavior: "smooth" });

  try {
    const data = await api.getHint({ subject: state.subject, question, level: level + 1, primary: state.model });
    msg.innerHTML = `<div class="hint-msg"><div class="hint-title">Hint ${level + 1} · ${HINT_LABELS[level]}</div><div class="prose">${rich(data.hint)}</div></div>`;
    drawMermaid(msg);
    state.hintLevel = level + 1;
  } catch (err) {
    if (err.status === 401) return backToLogin();
    msg.remove();
    toast(err.message, "error");
  } finally {
    state.busy = false;
    // Only the next hint can be clicked (or the same one again after an error)
    $$("[data-hint]").forEach((b, i) => (b.disabled = i !== state.hintLevel));
    msg.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function clearChat() {
  state.history = [];
  resetHints();
  $("#thread").innerHTML = `
    <div class="empty" id="ask-empty">
      <h2>What are you working on?</h2>
      <p class="muted">Ask about a concept or paste a problem. Try one of these:</p>
      <div class="suggestions" id="suggestions"></div>
    </div>`;
  renderSuggestions();
  $("#clear-chat").hidden = true;
}

// Prompt templates: fill the composer and select the first [gap] to type over.
function useTemplate(t) {
  const input = $("#question");
  input.value = t.text;
  input.dispatchEvent(new Event("input"));
  input.focus();
  const start = t.text.indexOf("[");
  if (start >= 0) input.setSelectionRange(start, t.text.indexOf("]", start) + 1);
}

function initTemplates() {
  const btn = $("#tpl-btn");
  const pop = $("#tpl-pop");
  pop.innerHTML = PROMPT_TEMPLATES.map((t, i) => `
    <button type="button" role="menuitem" class="popover-item tpl-item" data-tpl="${i}">
      <span>${escapeHtml(t.label)}</span><small>${escapeHtml(t.text.replace(/\n/g, " "))}</small>
    </button>`).join("");
  const close = (focusBtn) => { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); if (focusBtn) btn.focus(); };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.setAttribute("aria-expanded", String(!pop.hidden));
    if (!pop.hidden) $(".tpl-item", pop).focus();
  });
  pop.addEventListener("click", (e) => {
    const item = e.target.closest("[data-tpl]");
    if (!item) return;
    close(false);
    useTemplate(PROMPT_TEMPLATES[item.dataset.tpl]);
  });
  // Arrow keys move through the list; Escape closes it.
  pop.addEventListener("keydown", (e) => {
    const items = $$(".tpl-item", pop);
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === "Escape") { e.stopPropagation(); close(true); }
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) close(false); });
}

function initAsk() {
  renderSuggestions();
  initTemplates();
  const input = $("#question");

  $$("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  $("#thread").addEventListener("click", (e) => {
    if (e.target.matches(".suggestion")) ask(e.target.textContent);
  });
  $("#hints").addEventListener("click", (e) => {
    const b = e.target.closest("[data-hint]");
    if (b && !b.disabled) showHint(Number(b.dataset.hint));
  });
  $("#clear-chat").addEventListener("click", clearChat);

  const autosize = () => { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; };
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#composer").requestSubmit(); }
  });
  $("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return input.focus();
    input.value = "";
    autosize();
    ask(text);
  });
}

/* ---------- Study: flashcards (Leitner boxes) ---------- */

const cards = { deck: null, pos: 0, flipped: false, reviewed: 0, lastFlip: 0 };

function loadDeck(id) {
  const deck = DECKS.find((d) => d.id === id) || DECKS[0];
  // Lowest box first: those cards need the most practice.
  cards.deck = { ...deck, cards: deck.cards.map((c) => ({ ...c })).sort((a, b) => a.box - b.box) };
  cards.pos = 0;
  cards.reviewed = 0;
  $("#card-stage").hidden = false;
  $("#cards-done").hidden = true;
  renderCard();
}

function renderBoxes() {
  const counts = [1, 2, 3, 4, 5].map((n) => cards.deck.cards.filter((c) => c.box === n).length);
  $("#boxes").innerHTML = counts.map((c, i) => `<div class="box" title="Box ${i + 1}"><b>${c}</b><span>Box ${i + 1}</span></div>`).join("");
}

function renderCard() {
  const card = cards.deck.cards[cards.pos];
  const wasFlipped = cards.flipped;
  cards.flipped = false;
  $("#flashcard").classList.remove("flipped");
  $("#ratings").classList.remove("show");
  // Swap text once the card has turned back, so the next answer is never seen early.
  setTimeout(() => {
    $("#card-front").innerHTML = rich(card.front, true);
    $("#card-back").innerHTML = rich(card.back, true);
    $("#card-fig").innerHTML = card.figure ? figure(card.figure) : "";
    $("#card-fig").hidden = !card.figure;
    $("#flashcard").classList.toggle("has-fig", Boolean(card.figure));
  }, wasFlipped ? 300 : 0);
  $("#card-pos").textContent = `Card ${cards.pos + 1} of ${cards.deck.cards.length} · Box ${card.box}`;
  renderBoxes();
}

function flip() {
  cards.flipped = !cards.flipped;
  cards.lastFlip = Date.now();
  $("#flashcard").classList.toggle("flipped", cards.flipped);
  $("#ratings").classList.toggle("show", cards.flipped);
}

function move(step) {
  const n = cards.deck.cards.length;
  cards.pos = (cards.pos + step + n) % n;
  renderCard();
}

function rate(rating) {
  const card = cards.deck.cards[cards.pos];
  // Leitner rules: Again → box 1, Hard → stay, Good → +1, Easy → +2 (max 5).
  card.box = { again: 1, hard: card.box, good: Math.min(5, card.box + 1), easy: Math.min(5, card.box + 2) }[rating];
  cards.reviewed++;
  DASHBOARD.cardsDue = Math.max(0, DASHBOARD.cardsDue - 1);
  const today = REVIEWS_WEEK.find((d) => d.today);
  if (today) today.value++;

  if (cards.pos >= cards.deck.cards.length - 1) {
    renderBoxes();
    $("#card-stage").hidden = true;
    $("#cards-done").hidden = false;
    const known = cards.deck.cards.filter((c) => c.box >= 3).length;
    $("#cards-done-text").textContent = `You reviewed ${cards.reviewed} cards. ${known} of ${cards.deck.cards.length} are now in box 3 or higher.`;
    $("#cards-restart").focus();
    return;
  }
  cards.pos++;
  renderCard();
}

function initFlashcards() {
  const opt = (d) => `<option value="${d.id}">${d.name} (${d.cards.length} cards)</option>`;
  $("#deck").innerHTML = `<optgroup label="Your decks">${DECKS.filter((d) => !d.template).map(opt).join("")}</optgroup>
    <optgroup label="Starter templates">${DECKS.filter((d) => d.template).map(opt).join("")}</optgroup>`;
  $("#deck").addEventListener("change", (e) => loadDeck(e.target.value));
  $("#flashcard").addEventListener("click", () => {
    // A Space key press is already handled below; ignore the duplicate click.
    if (Date.now() - cards.lastFlip > 250) flip();
  });
  $("#ratings").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rate]");
    if (b) rate(b.dataset.rate);
  });
  $("#cards-restart").addEventListener("click", () => loadDeck(cards.deck.id));

  document.addEventListener("keydown", (e) => {
    const active = !$('[data-view="study"]').hidden && !$("#panel-cards").hidden && !$("#card-stage").hidden;
    if (!active || e.target.matches("input, select, textarea") || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === " ") { e.preventDefault(); flip(); }
    else if (e.key === "ArrowRight") move(1);
    else if (e.key === "ArrowLeft") move(-1);
    else if (cards.flipped && ["1", "2", "3", "4"].includes(e.key)) rate(["again", "hard", "good", "easy"][Number(e.key) - 1]);
  });

  loadDeck(DECKS[0].id);
}

/* ---------- Study: quiz ---------- */

const quiz = { questions: [], i: 0, results: [], timed: false, timer: null, left: 0, difficulty: "Medium" };

function stopTimer() { clearInterval(quiz.timer); quiz.timer = null; }

async function startQuiz(e) {
  e.preventDefault();
  const topic = $("#quiz-topic").value.trim();
  if (!topic) { toast("Enter a topic for the quiz.", "error"); return $("#quiz-topic").focus(); }

  quiz.questions = QUIZ_BANK.slice(0, Number($("#quiz-count").value));
  quiz.difficulty = $("#quiz-diff").value;
  quiz.timed = $("#quiz-timer").checked;
  quiz.topic = topic;
  quiz.i = 0;
  quiz.results = [];

  $("#quiz-setup").hidden = true;
  $("#quiz-area").innerHTML = `
    <div class="card quiz-card" aria-label="Generating quiz">
      <div class="skeleton" style="width:30%"></div>
      <div class="skeleton" style="width:85%;height:16px"></div>
      ${[1, 2, 3, 4].map(() => '<div class="skeleton" style="height:42px"></div>').join("")}
    </div>`;
  await wait(900);
  renderQuestion();
}

function renderQuestion() {
  const q = quiz.questions[quiz.i];
  const body = q.type === "mcq"
    ? `<fieldset class="options" style="border:0;padding:0;margin:0">
         <legend class="sr-only">Choose one answer</legend>
         ${q.options.map((o, k) => `<label class="option"><input type="radio" name="opt" value="${k}" /> <span>${rich(o, true)}</span></label>`).join("")}
       </fieldset>`
    : `<div class="field"><label for="short">Your answer</label><input class="input" id="short" autocomplete="off" /></div>`;

  $("#quiz-area").innerHTML = `
    <div class="card quiz-card">
      <div class="quiz-top">
        <span class="muted small">Question ${quiz.i + 1} of ${quiz.questions.length} · ${quiz.difficulty}</span>
        ${quiz.timed ? '<span class="quiz-timer" id="timer" aria-live="off"></span>' : ""}
      </div>
      <div class="progress" aria-hidden="true"><span style="width:${(quiz.i / quiz.questions.length) * 100}%"></span></div>
      <div class="quiz-q">${rich(q.q, true)}</div>
      <form id="answer-form" class="options">${body}<div id="feedback"></div>
        <div class="quiz-actions"><button class="btn btn-primary" id="quiz-next" type="submit">Check answer</button></div>
      </form>
    </div>`;

  $("#answer-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (quiz.results.length > quiz.i) return nextQuestion();
    checkAnswer(false);
  });
  ($('input[name="opt"]') || $("#short"))?.focus();

  if (quiz.timed) {
    quiz.left = 60;
    const tick = () => {
      const t = $("#timer");
      if (!t) return stopTimer();
      t.textContent = `0:${String(quiz.left).padStart(2, "0")}`;
      t.classList.toggle("low", quiz.left <= 10);
      if (quiz.left-- <= 0) { stopTimer(); checkAnswer(true); }
    };
    tick();
    quiz.timer = setInterval(tick, 1000);
  }
}

function checkAnswer(timedOut) {
  const q = quiz.questions[quiz.i];
  let given = null;
  let correct = false;

  if (q.type === "mcq") {
    const picked = $('input[name="opt"]:checked');
    if (!picked && !timedOut) return toast("Choose an answer first.");
    given = picked ? Number(picked.value) : null;
    correct = given === q.answer;
    $$(".option").forEach((el, k) => {
      if (k === q.answer) el.classList.add("correct");
      else if (k === given) el.classList.add("wrong");
      $("input", el).disabled = true;
    });
  } else {
    const input = $("#short");
    if (!input.value.trim() && !timedOut) return toast("Enter an answer first.");
    given = input.value.trim();
    correct = q.accept.includes(given.replace(/\s+/g, "").toLowerCase());
    input.disabled = true;
  }

  stopTimer();
  quiz.results.push({ q, given, correct });

  const right = q.type === "mcq" ? q.options[q.answer] : q.display;
  $("#feedback").innerHTML = `
    <div class="feedback ${correct ? "ok" : "bad"}">
      <div class="feedback-title">
        ${correct ? "Correct" : timedOut ? "Time is up" : "Not quite"}
        ${q.verified ? `<span class="badge badge-success" title="Correct answer checked with the SymPy solver">${ICON_CHECK}Verified</span>` : ""}
      </div>
      ${correct ? "" : `<div>Correct answer: ${rich(right, true)}</div>`}
      <div class="muted">${rich(q.explanation, true)}</div>
    </div>`;
  const last = quiz.i === quiz.questions.length - 1;
  $("#quiz-next").textContent = last ? "See results" : "Next question";
  $("#quiz-next").focus();
}

function nextQuestion() {
  if (quiz.i < quiz.questions.length - 1) { quiz.i++; return renderQuestion(); }
  renderScore();
}

function renderScore() {
  const score = quiz.results.filter((r) => r.correct).length;
  const total = quiz.results.length;
  const mistakes = quiz.results.filter((r) => !r.correct);
  DASHBOARD.lastQuiz = { score, total, topic: quiz.topic, when: "just now" };
  QUIZ_HISTORY.push({ label: "Today", value: Math.round((score / total) * 100) });

  const pct = Math.round((score / total) * 100);
  const note = pct === 100 ? "Excellent. Every answer was correct."
    : pct >= 70 ? "Good work. Review the questions you missed."
    : "Keep practising. Reviewing your mistakes is the quickest way to improve.";

  $("#quiz-area").innerHTML = `
    <div class="card score">
      <span class="muted small">${escapeHtml(quiz.topic)} · ${quiz.difficulty}</span>
      <span class="score-num">${score}/${total}</span>
      <p class="muted">${note}</p>
      <div class="quiz-actions" style="justify-content:center;margin-top:8px">
        ${mistakes.length ? '<button class="btn" id="review">Review my mistakes</button>' : ""}
        <button class="btn btn-primary" id="new-quiz">New quiz</button>
      </div>
      <ul class="review-list" id="review-list" hidden style="text-align:left;width:100%">
        ${mistakes.map((m) => {
          const yours = m.given === null || m.given === "" ? "No answer"
            : m.q.type === "mcq" ? rich(m.q.options[m.given], true) : escapeHtml(m.given);
          const right = m.q.type === "mcq" ? m.q.options[m.q.answer] : m.q.display;
          return `<li><strong>${rich(m.q.q, true)}</strong>
            <span class="muted">Your answer: ${yours}</span>
            <span>Correct answer: ${rich(right, true)}</span>
            <span class="muted">${rich(m.q.explanation, true)}</span></li>`;
        }).join("")}
      </ul>
    </div>`;

  $("#review")?.addEventListener("click", (e) => {
    const list = $("#review-list");
    list.hidden = !list.hidden;
    e.target.textContent = list.hidden ? "Review my mistakes" : "Hide mistakes";
  });
  $("#new-quiz").addEventListener("click", () => {
    $("#quiz-area").innerHTML = "";
    $("#quiz-setup").hidden = false;
    $("#quiz-topic").focus();
  });
}

// Quiz templates fill the setup form in one click.
function initQuizTemplates() {
  const wrap = $("#quiz-templates");
  wrap.innerHTML = QUIZ_TEMPLATES.map((t) => `
    <button type="button" class="tpl-card" data-qtpl="${t.id}" aria-pressed="false">
      <strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.desc)}</span>
    </button>`).join("");
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-qtpl]");
    if (!b) return;
    const t = QUIZ_TEMPLATES.find((q) => q.id === b.dataset.qtpl);
    $("#quiz-topic").value = t.topic;
    $("#quiz-diff").value = t.difficulty;
    $("#quiz-count").value = String(t.count);
    $("#quiz-timer").checked = t.timer;
    $$("[data-qtpl]", wrap).forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  });
  // Changing a field by hand means no template is selected any more.
  $("#quiz-setup").addEventListener("input", (e) => {
    if (!e.target.closest("#quiz-templates")) $$("[data-qtpl]", wrap).forEach((x) => x.setAttribute("aria-pressed", "false"));
  });
}

function initStudy() {
  initQuizTemplates();
  const tabs = [$("#tab-cards"), $("#tab-quiz")];
  const select = (tab) => {
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute("aria-controls")}`).hidden = !on;
    });
  };
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => select(t));
    t.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        e.stopPropagation();
        const next = tabs[(i + 1) % tabs.length];
        select(next);
        next.focus();
      }
    });
  });
  $("#quiz-setup").addEventListener("submit", startQuiz);
  initFlashcards();
}

/* ---------- Roadmap ---------- */

// Your plan is saved in this browser (localStorage), like Today's plan.
// { tpl, subject, examDate, hours, level, sections: [{ title, dates, tasks: [{ id, text, done }] }] }
const ROADMAP_KEY = "eduguardian_roadmap";
let roadmap = loadRoadmap();
let roadmapTpl = roadmap?.tpl || ROADMAP_TEMPLATES[0].id;

function loadRoadmap() {
  try { return JSON.parse(localStorage.getItem(ROADMAP_KEY)) || null; } catch (e) { return null; }
}

function saveRoadmap() {
  try { localStorage.setItem(ROADMAP_KEY, JSON.stringify(roadmap)); } catch (e) {}
  syncProgress();
}

// Sends roadmap progress to the backend so a linked parent can see it.
// Waits a second after the last tick, so ticking five tasks sends one update.
let syncTimer = null;
function syncProgress() {
  clearTimeout(syncTimer);
  if (!roadmap) return;
  syncTimer = setTimeout(() => {
    const r = roadmapStats();
    api.saveProgress({ percent: r.progress, done: r.done, total: r.total, subject: roadmap.subject || "", exam_date: roadmap.examDate || "" })
      .catch(() => {}); // the plan still works in this browser if this fails
  }, 1000);
}

const DAY = 24 * 3600 * 1000;
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const shortDate = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const longDate = (iso) => new Date(`${iso}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const daysUntil = (iso) => Math.round((new Date(`${iso}T00:00`) - startOfToday()) / DAY);
let nextId = 0;
const makeTasks = (texts) => texts.map((text) => ({ id: `r${Date.now()}${nextId++}`, text, done: false }));

// Turns a template + your answers into a plan. The 2-week template stretches to
// fit your exam date: learning weeks first, then a final practise-and-revise week.
function buildRoadmap(tplId, { subject, examDate, hours, level }) {
  const t = ROADMAP_TEMPLATES.find((r) => r.id === tplId);
  let sections;
  if (tplId === "two-week") {
    const days = Math.max(1, daysUntil(examDate));
    const weeks = Math.min(12, Math.max(1, Math.ceil(days / 7)));
    const exam = new Date(`${examDate}T00:00`);
    sections = Array.from({ length: weeks }, (_, i) => {
      const last = i === weeks - 1;
      const from = new Date(startOfToday().getTime() + i * 7 * DAY);
      const to = last ? new Date(exam.getTime() - DAY) : new Date(from.getTime() + 6 * DAY);
      const src = last ? t.weeks[1] : t.weeks[0];
      return {
        title: `Week ${i + 1} · ${last ? "Practise and revise" : "Learn"}`,
        dates: `${shortDate(from)} – ${shortDate(to < from ? from : to)}`,
        tasks: makeTasks(src.tasks),
      };
    });
  } else {
    sections = t.weeks.map((w) => ({ title: w.title, dates: "", tasks: makeTasks(w.tasks) }));
  }
  if (level === "Beginner") sections[0].tasks.unshift(...makeTasks([`Go through worked examples in ${subject} before practising`]));
  if (level === "Advanced") sections.at(-1).tasks.push(...makeTasks(["Try the hardest past-paper questions"]));
  return { tpl: tplId, subject, examDate, hours, level, sections };
}

function roadmapStats() {
  const all = roadmap.sections.flatMap((s) => s.tasks);
  const done = all.filter((t) => t.done).length;
  return {
    done, total: all.length,
    progress: all.length ? Math.round((done / all.length) * 100) : 0,
    exam: roadmap.subject, examDate: longDate(roadmap.examDate),
  };
}

const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';

function renderRoadmap() {
  const box = $("#roadmap-preview");
  if (!roadmap) { box.innerHTML = '<p class="muted">Fill in the form and press <strong>Build my plan</strong>.</p>'; return; }
  const st = roadmapStats();
  const days = daysUntil(roadmap.examDate);
  const countdown = days > 1 ? `${days} days to go` : days === 1 ? "Exam is tomorrow" : days === 0 ? "Exam is today" : "Exam date has passed";
  const tpl = ROADMAP_TEMPLATES.find((r) => r.id === roadmap.tpl);
  box.innerHTML = `
    <div class="rm-head">
      <div>
        <h3 class="section-h">${escapeHtml(roadmap.subject)} · ${escapeHtml(tpl?.name || "Plan")}</h3>
        <p class="muted small">Exam on ${longDate(roadmap.examDate)} · ${escapeHtml(roadmap.hours)} ${Number(roadmap.hours) === 1 ? "hour" : "hours"} a day · ${escapeHtml(roadmap.level)}</p>
      </div>
      <span class="rm-countdown${days >= 0 && days <= 7 ? " soon" : ""}">${countdown}</span>
    </div>
    <div class="rm-progress">
      <div class="progress" aria-hidden="true"><span style="width:${st.progress}%"></span></div>
      <span class="small muted">${st.done} of ${st.total} tasks done · ${st.progress}%</span>
    </div>
    <div class="plan-weeks">${roadmap.sections.map((sec, si) => {
      const doneHere = sec.tasks.filter((t) => t.done).length;
      return `
      <div class="plan-week${sec.tasks.length && doneHere === sec.tasks.length ? " complete" : ""}">
        <div class="plan-week-head">
          <h4>${escapeHtml(sec.title)}</h4>
          <span class="small muted">${sec.dates ? `${escapeHtml(sec.dates)} · ` : ""}${doneHere}/${sec.tasks.length}</span>
        </div>
        <ul class="rm-tasks">${sec.tasks.map((t) => `
          <li class="${t.done ? "done" : ""}">
            <input type="checkbox" id="rm-${escapeHtml(t.id)}" data-rm-task="${escapeHtml(t.id)}" ${t.done ? "checked" : ""} />
            <label for="rm-${escapeHtml(t.id)}">${escapeHtml(t.text)}</label>
            <button type="button" class="rm-icon" data-rm-today="${escapeHtml(t.id)}" title="Add to today's plan" aria-label="Add to today's plan: ${escapeHtml(t.text)}">${ICON_PLUS}</button>
            <button type="button" class="rm-icon rm-del" data-rm-del="${escapeHtml(t.id)}" title="Delete task" aria-label="Delete task: ${escapeHtml(t.text)}">${ICON_X}</button>
          </li>`).join("")}
        </ul>
        <form class="rm-add" data-rm-add="${si}">
          <label class="sr-only" for="rm-add-${si}">Add a task to ${escapeHtml(sec.title)}</label>
          <input class="input" id="rm-add-${si}" placeholder="Add a task…" maxlength="120" autocomplete="off" />
          <button class="btn btn-sm" type="submit">Add</button>
        </form>
      </div>`;
    }).join("")}
    </div>`;
}

function findRoadmapTask(id) {
  for (const sec of roadmap.sections) {
    const task = sec.tasks.find((t) => t.id === id);
    if (task) return { sec, task };
  }
  return {};
}

function selectRoadmapTpl(id) {
  roadmapTpl = id;
  $$("[data-rtpl]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rtpl === id)));
}

function initRoadmap() {
  const wrap = $("#roadmap-templates");
  wrap.innerHTML = ROADMAP_TEMPLATES.map((t) => `
    <button type="button" class="tpl-card" data-rtpl="${t.id}" aria-pressed="false">
      <strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.desc)}</span>
    </button>`).join("");
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rtpl]");
    if (!b) return;
    selectRoadmapTpl(b.dataset.rtpl);
    $("#rm-hours").value = ROADMAP_TEMPLATES.find((r) => r.id === b.dataset.rtpl).hours;
  });

  $("#rm-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const answers = {
      subject: $("#rm-subject").value.trim() || "My subject",
      examDate: $("#rm-date").value,
      hours: Number($("#rm-hours").value) || 2,
      level: $("#rm-level").value,
    };
    if (daysUntil(answers.examDate) < 1) return toast("Please pick an exam date after today.", "error");
    if (roadmap && roadmapStats().done > 0 && !confirm("Build a new plan? Your ticked tasks in the current plan will be cleared.")) return;
    roadmap = buildRoadmap(roadmapTpl, answers);
    saveRoadmap();
    renderRoadmap();
    toast("Your plan is ready");
  });

  const box = $("#roadmap-preview");
  box.addEventListener("change", (e) => {
    const { task } = findRoadmapTask(e.target.dataset.rmTask);
    if (!task) return;
    task.done = e.target.checked;
    saveRoadmap();
    renderRoadmap();
    $(`#rm-${task.id}`)?.focus();
  });
  box.addEventListener("click", (e) => {
    const today = e.target.closest("[data-rm-today]");
    const del = e.target.closest("[data-rm-del]");
    if (today) {
      const { task } = findRoadmapTask(today.dataset.rmToday);
      if (task) { addTask(task.text, Math.round(((roadmap.hours || 2) * 60) / 3 / 5) * 5 || 30); toast("Added to today's plan on Home"); }
    } else if (del) {
      const { sec, task } = findRoadmapTask(del.dataset.rmDel);
      if (!task) return;
      sec.tasks = sec.tasks.filter((t) => t !== task);
      saveRoadmap();
      renderRoadmap();
    }
  });
  box.addEventListener("submit", (e) => {
    const form = e.target.closest("[data-rm-add]");
    if (!form) return;
    e.preventDefault();
    const input = $("input", form);
    const text = input.value.trim();
    if (!text) return input.focus();
    const si = Number(form.dataset.rmAdd);
    roadmap.sections[si].tasks.push(...makeTasks([text]));
    saveRoadmap();
    renderRoadmap();
    $(`#rm-add-${si}`).focus();
  });

  // Start from your saved plan, or build the first one for you
  if (roadmap) {
    $("#rm-subject").value = roadmap.subject;
    $("#rm-date").value = roadmap.examDate;
    $("#rm-hours").value = roadmap.hours;
    $("#rm-level").value = roadmap.level;
  } else if (daysUntil($("#rm-date").value) >= 1) {
    roadmap = buildRoadmap(roadmapTpl, {
      subject: $("#rm-subject").value, examDate: $("#rm-date").value,
      hours: Number($("#rm-hours").value), level: $("#rm-level").value,
    });
    saveRoadmap();
  }
  selectRoadmapTpl(roadmapTpl);
  renderRoadmap();
}

/* ---------- Syllabus uploads (Syllabus, Study and Roadmap pages) ---------- */

let syllabusFiles = [];

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Redraws the file list (Syllabus page) and the short summary (Study and Roadmap)
function renderSyllabus() {
  $("#syllabus-files").innerHTML = syllabusFiles.length ? syllabusFiles.map((f) => `
    <li>
      <span class="file-name">${escapeHtml(f.name)}</span>
      <span class="muted small">${escapeHtml(subjectName(f.subject))} · ${formatSize(f.size)}</span>
      <button type="button" class="btn btn-ghost btn-sm" data-del-file="${escapeHtml(f.id)}" aria-label="Delete ${escapeHtml(f.name)}">Delete</button>
    </li>`).join("") : '<li class="muted small">No files yet.</li>';

  const mine = syllabusFiles.filter((f) => f.subject === state.subject);
  $$("[data-syllabus-summary]").forEach((el) => {
    if (!el.dataset.empty) el.dataset.empty = el.textContent;
    el.textContent = mine.length
      ? `${subjectName(state.subject)}: ${mine.map((f) => f.name).slice(0, 2).join(", ")}${mine.length > 2 ? ` and ${mine.length - 2} more` : ""}`
      : el.dataset.empty;
  });
}

async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  $$("[data-upload-syllabus]").forEach((b) => (b.disabled = true));
  let added = 0;
  for (const file of files) {
    try {
      syllabusFiles.unshift(await api.uploadSyllabus(file, state.subject));
      added++;
    } catch (err) {
      if (err.status === 401) return backToLogin();
      toast(`${file.name}: ${err.message}`, "error");
    }
  }
  $$("[data-upload-syllabus]").forEach((b) => (b.disabled = false));
  renderSyllabus();
  if (added) toast(`Uploaded ${added} ${added === 1 ? "file" : "files"} for ${subjectName(state.subject)}`);
}

function initSyllabus() {
  const input = $("#syllabus-input");
  $$("[data-upload-syllabus]").forEach((b) => b.addEventListener("click", () => input.click()));
  input.addEventListener("change", () => {
    uploadFiles(input.files);
    input.value = ""; // so the same file can be chosen again
  });

  // Drag and drop onto the big box on the Syllabus page
  const drop = $("#syllabus-drop");
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    uploadFiles(e.dataTransfer.files);
  });

  $("#syllabus-files").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-del-file]");
    if (!b) return;
    const id = Number(b.dataset.delFile);
    const file = syllabusFiles.find((f) => f.id === id);
    if (!file || !confirm(`Delete "${file.name}"?`)) return;
    try {
      await api.deleteSyllabus(id);
      syllabusFiles = syllabusFiles.filter((f) => f.id !== id);
      renderSyllabus();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  $("#subject").addEventListener("change", renderSyllabus);
  renderSyllabus();
  api.listSyllabus().then((files) => { syllabusFiles = files; renderSyllabus(); }).catch(() => {});
}

/* ---------- Parent link (account menu) ---------- */

function renderParents(parents) {
  $("#family-parents").innerHTML = parents.length
    ? `<p class="small">Linked parents: <strong>${parents.map(escapeHtml).join(", ")}</strong></p>`
    : `<p class="small muted">No parent is linked yet.</p>`;
}

// Asks the backend whether a parent turned on hint mode, and who is linked.
async function loadFamily() {
  try {
    const f = await api.familyStatus();
    state.hintLocked = f.answer_mode === "hints";
    renderParents(f.parents);
    setMode(state.mode);
  } catch (e) {
    // Not a problem: the server still applies hint mode to every answer
  }
}

function initFamily() {
  const dialog = $("#family-dialog");
  $("#parent-link-btn").addEventListener("click", () => {
    $("#user-pop").hidden = true;
    $("#family-code").hidden = true;
    dialog.showModal();
    loadFamily();
  });
  $("#family-close").addEventListener("click", () => dialog.close());
  $("#family-make").addEventListener("click", async () => {
    const btn = $("#family-make");
    btn.disabled = true;
    try {
      const data = await api.makeParentCode();
      $("#family-code-value").textContent = data.code;
      $("#family-minutes").textContent = data.minutes;
      $("#family-code").hidden = false;
      btn.textContent = "Make a new code";
    } catch (err) {
      if (err.status === 401) return backToLogin();
      toast(err.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
}

/* ---------- Start ---------- */

// The workspace is for signed-in students only. Parents have their own dashboard.
if (!api.getToken()) backToLogin();
if (api.getUser()?.role === "parent") location.replace("/parent.html");
// Check the saved login is still valid (it lasts 7 days). Runs in the background.
api.me().catch((err) => {
  if (err.status === 401) backToLogin();
  else toast(err.message, "error"); // e.g. the backend is not running
});

initTopbar();
initHome();
initAsk();
initStudy();
initRoadmap();
initSyllabus();
initFamily();
setMode("normal");
loadFamily();
syncProgress(); // so a parent sees the roadmap even before the next tick
window.addEventListener("hashchange", () => route(true));
route(false);

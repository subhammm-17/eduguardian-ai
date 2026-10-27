// EduGuardian AI workspace.
// Screens: Home, Ask (Normal + Socratic), Study (Flashcards + Quiz), plus
// Syllabus and Roadmap previews.
// Sign-in, Ask, hints and graphs use the FastAPI backend (through api.js).
// Home, Study, Syllabus and Roadmap still use sample data from fixtures.js.
import * as api from "./api.js";
import {
  SUBJECTS, MODELS, DASHBOARD, TODAY_TASKS, RECENT_QUESTIONS, SUGGESTIONS,
  HINT_LABELS, DECKS, QUIZ_BANK,
  QUIZ_HISTORY, REVIEWS_WEEK, PROMPT_TEMPLATES, QUIZ_TEMPLATES, ROADMAP_TEMPLATES,
} from "./fixtures.js";
import { figure, lineChart, barChart, wireCharts } from "./figures.js";

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
  let html = inline ? marked.parseInline(text) : marked.parse(text);
  html = callouts(DOMPurify.sanitize(html));
  return html.replace(/@@M(\d+)@@/g, (_, i) => {
    const m = math[i];
    if (!window.katex) return escapeHtml(m.t);
    return katex.renderToString(m.t, { displayMode: m.display && !inline, throwOnError: false });
  });
}

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
  const r = DASHBOARD.roadmap;
  $("#stat-road").textContent = `${r.progress}%`;
  $("#stat-road-bar").style.width = `${r.progress}%`;
  $("#stat-road-meta").textContent = `${r.exam} · exam on ${r.examDate}`;

  const list = $("#today-tasks");
  list.innerHTML = TODAY_TASKS.map((t) => `
    <li class="${t.done ? "done" : ""}">
      <input type="checkbox" id="task-${t.id}" data-task="${t.id}" ${t.done ? "checked" : ""} />
      <label for="task-${t.id}">${escapeHtml(t.title)}</label>
      <span class="task-meta">${t.minutes} min</span>
    </li>`).join("");
  updateTaskCount();

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

function updateTaskCount() {
  const done = TODAY_TASKS.filter((t) => t.done).length;
  $("#today-count").textContent = `${done} of ${TODAY_TASKS.length} done`;
}

function initHome() {
  $("#today-tasks").addEventListener("change", (e) => {
    const task = TODAY_TASKS.find((t) => t.id === e.target.dataset.task);
    if (!task) return;
    task.done = e.target.checked;
    e.target.closest("li").classList.toggle("done", task.done);
    updateTaskCount();
  });
}

/* ---------- Ask ---------- */

const MODE_DESC = {
  normal: "Full explanations with worked solutions.",
  socratic: "Guiding questions and hints. The final answer is never given.",
};

function renderSuggestions() {
  $("#suggestions").innerHTML = SUGGESTIONS[state.subject]
    .map((s) => `<button type="button" class="btn suggestion">${escapeHtml(s)}</button>`).join("");
}

function setMode(mode) {
  state.mode = mode;
  $$("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $("#mode-desc").textContent = MODE_DESC[mode];
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

function metaBadges({ socratic, verified, by }) {
  let html = `<span class="badge">${subjectName(state.subject)}</span>`;
  if (socratic) html += `<span class="badge badge-accent">Socratic</span>`;
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
    const { text: answer, answeredBy } = await api.askStream(
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
    // Verified stays off until answer checking with SymPy is added (PLAN.md, milestone 4).
    $(".msg-meta", msg).innerHTML = metaBadges({ socratic, verified: false, by: answeredBy });
    state.history.push({ role: "ai", text: answer, socratic });
    // Graphs appear only in Normal mode, where giving the answer is allowed.
    if (!socratic && subject === "maths") await addPlot(msg, text);
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

/* ---------- Roadmap templates ---------- */

function showRoadmapTemplate(id) {
  const t = ROADMAP_TEMPLATES.find((r) => r.id === id);
  $$("[data-rtpl]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.rtpl === id)));
  $("#rm-hours").value = t.hours;
  $("#roadmap-preview").innerHTML = `
    <div><h3 class="section-h">${escapeHtml(t.name)}</h3><p class="muted small">${escapeHtml(t.desc)} About ${t.hours} ${t.hours === 1 ? "hour" : "hours"} a day.</p></div>
    <div class="plan-weeks">${t.weeks.map((w) => `
      <div class="plan-week"><h4>${escapeHtml(w.title)}</h4>
        <ul>${w.tasks.map((task) => `<li>${escapeHtml(task)}</li>`).join("")}</ul></div>`).join("")}
    </div>`;
}

function initRoadmap() {
  const wrap = $("#roadmap-templates");
  wrap.innerHTML = ROADMAP_TEMPLATES.map((t) => `
    <button type="button" class="tpl-card" data-rtpl="${t.id}" aria-pressed="false">
      <strong>${escapeHtml(t.name)}</strong><span>${escapeHtml(t.desc)}</span>
    </button>`).join("");
  wrap.addEventListener("click", (e) => {
    const b = e.target.closest("[data-rtpl]");
    if (b) showRoadmapTemplate(b.dataset.rtpl);
  });
  showRoadmapTemplate(ROADMAP_TEMPLATES[0].id);
}

/* ---------- Start ---------- */

// The workspace is for signed-in students only.
if (!api.getToken()) backToLogin();
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
setMode("normal");
window.addEventListener("hashchange", () => route(true));
route(false);

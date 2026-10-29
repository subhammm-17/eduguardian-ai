// Parent dashboard (parent.html).
// A parent links a child with a one-time code, sees their progress,
// and chooses how the AI answers them. All of it lives in backend/family.py
// (the plan, quiz and flashcard numbers come from backend/study.py).
import * as api from "./api.js?v=16";
import { barChart, wireCharts } from "./figures.js?v=16";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const page = { children: [], current: null };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(message, type = "") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), 3500);
}

function backToLogin() {
  api.clearLogin();
  location.href = "/login.html";
}

// "5 min ago", "3 h ago", "2 days ago" from Unix seconds
function ago(seconds) {
  if (!seconds) return "never";
  const mins = Math.round((Date.now() / 1000 - seconds) / 60);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

const MODE_NAMES = { hints: "Hints and partial steps", direct: "Direct answers" };
const KIND_NAMES = { question: "Question", hint: "Hint" };

/* ---------- Children list (tabs) ---------- */

function renderTabs() {
  $("#no-children").hidden = page.children.length > 0;
  $("#child").hidden = !page.current;
  $("#child-tabs").innerHTML = page.children.map((c) => `
    <button type="button" role="tab" class="child-tab" data-child="${c.id}" aria-selected="${c.id === page.current?.id}">
      <strong>${escapeHtml(c.name)}</strong>
      <span class="small muted">${c.questions_week} questions this week · ${c.answer_mode === "hints" ? "Hint mode" : "Direct answers"}</span>
    </button>`).join("");
}

async function loadChildren(selectId) {
  try {
    page.children = await api.listChildren();
  } catch (err) {
    if (err.status === 401 || err.status === 403) return backToLogin();
    return toast(err.message, "error");
  }
  const pick = page.children.find((c) => c.id === selectId) || page.children[0];
  page.current = null;
  renderTabs();
  if (pick) await openChild(pick.id);
}

/* ---------- One child's dashboard ---------- */

// The last 7 days, oldest first, counted in this browser's own time zone
function perDay(times) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    days.push({ start: d.getTime(), label: d.toLocaleDateString("en-GB", { weekday: "short" }), value: 0, today: i === 0 });
  }
  for (const t of times) {
    const ms = t * 1000;
    const day = [...days].reverse().find((d) => ms >= d.start);
    if (day) day.value += 1;
  }
  return days;
}

function renderChild(c) {
  page.current = c;
  renderTabs();
  $("#child-name-mode").textContent = c.name.split(" ")[0];
  $("#mode-badge").textContent = MODE_NAMES[c.answer_mode];
  $("#mode-badge").className = `badge ${c.answer_mode === "hints" ? "badge-warn" : "badge-success"}`;
  $$('input[name="answer-mode"]').forEach((r) => (r.checked = r.value === c.answer_mode));

  $("#c-week").textContent = c.questions_week;
  $("#c-total").textContent = `${c.questions_total} questions in total`;
  $("#c-hints").textContent = c.hints_week;
  $("#c-last").textContent = `Last active ${ago(c.last_active)}`;

  const r = c.roadmap;
  $("#c-road").textContent = r ? `${r.percent}%` : "–";
  $("#c-road-bar").style.width = `${r ? r.percent : 0}%`;
  $("#c-road-meta").textContent = r
    ? `${r.done} of ${r.total} tasks${r.subject ? ` · ${r.subject}` : ""}${r.exam_date ? ` · exam on ${new Date(`${r.exam_date}T00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}`
    : "No study roadmap made yet";

  // Study progress, saved by the child's workspace
  const st = c.study;
  $("#c-tasks").textContent = st.tasks_total ? `${st.tasks_done}/${st.tasks_total}` : "–";
  $("#c-tasks-bar").style.width = `${st.tasks_total ? Math.round((st.tasks_done / st.tasks_total) * 100) : 0}%`;
  $("#c-tasks-meta").textContent = st.tasks_total ? "tasks done" : "No tasks in their plan yet";
  $("#c-quizzes").textContent = st.quizzes_week;
  const lastQuiz = st.quizzes[0];
  $("#c-quizzes-meta").textContent = [
    st.quiz_average_week !== null ? `Average ${st.quiz_average_week}%` : "",
    lastQuiz ? `Last: ${lastQuiz.topic} ${lastQuiz.score}/${lastQuiz.total} (${ago(lastQuiz.at)})` : "No quizzes yet",
  ].filter(Boolean).join(" · ");
  $("#c-cards").textContent = st.cards_week;

  const days = perDay(c.week_times);
  const max = Math.max(4, Math.ceil(Math.max(...days.map((d) => d.value)) / 4) * 4); // steps of 4 give whole-number grid lines
  $("#c-chart").innerHTML = barChart(days, { max, title: "Questions per day", valueName: "Questions" });
  wireCharts($("#child"));

  const most = Math.max(1, ...Object.values(c.by_subject));
  $("#c-subjects").innerHTML = Object.entries(c.by_subject).map(([name, n]) => `
    <li><span class="small">${escapeHtml(name)}</span><span class="small muted">${n}</span>
      <div class="progress" aria-hidden="true"><span style="width:${Math.round((n / most) * 100)}%"></span></div></li>`).join("");

  $("#c-recent").innerHTML = c.recent.length
    ? c.recent.map((q) => `
      <li><span class="q">${escapeHtml(q.text)}</span>
        <span class="muted small">${KIND_NAMES[q.kind] || q.kind} · ${escapeHtml(q.subject)}${q.mode === "guided" ? " · answered with hints" : ""} · ${ago(q.at)}</span></li>`).join("")
    : `<li><span class="muted small">No questions yet.</span></li>`;
}

async function openChild(id) {
  try {
    renderChild(await api.childDetails(id));
  } catch (err) {
    if (err.status === 401 || err.status === 403) return backToLogin();
    toast(err.message, "error");
  }
}

/* ---------- Start ---------- */

function init() {
  if (!api.getToken()) return backToLogin();
  const user = api.getUser();
  if (user?.role !== "parent") return location.replace("/app.html");
  $("#parent-name").textContent = user.name;

  $("#logout").addEventListener("click", async () => {
    await api.logout();
    location.href = "/login.html";
  });

  $("#child-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-child]");
    if (tab) openChild(Number(tab.dataset.child));
  });

  $("#link-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = $("#link-code").value.trim();
    const error = $("#link-error");
    error.hidden = true;
    if (code.replace(/[^a-z0-9]/gi, "").length !== 8) {
      error.textContent = "The code has 8 letters and numbers, like ABCD-EFGH.";
      error.hidden = false;
      return;
    }
    $("#link-submit").disabled = true;
    try {
      const child = await api.linkChild(code);
      $("#link-code").value = "";
      toast(`${child.name} is now linked. Hint mode is on.`);
      await loadChildren(child.id);
    } catch (err) {
      if (err.status === 401) return backToLogin();
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      $("#link-submit").disabled = false;
    }
  });

  $$('input[name="answer-mode"]').forEach((radio) => radio.addEventListener("change", async () => {
    const c = page.current;
    if (!c || !radio.checked) return;
    try {
      await api.setAnswerMode(c.id, radio.value);
      toast(`${c.name.split(" ")[0]} now gets: ${MODE_NAMES[radio.value].toLowerCase()}.`);
      const summary = page.children.find((x) => x.id === c.id);
      if (summary) summary.answer_mode = radio.value;
      renderChild({ ...c, answer_mode: radio.value });
    } catch (err) {
      if (err.status === 401) return backToLogin();
      toast(err.message, "error");
      renderChild(c); // put the radio buttons back
    }
  }));

  $("#unlink").addEventListener("click", async () => {
    const c = page.current;
    if (!c || !confirm(`Unlink ${c.name}? You will stop seeing their progress and your answer setting no longer applies.`)) return;
    try {
      await api.unlinkChild(c.id);
      await loadChildren();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  loadChildren();
}

init();

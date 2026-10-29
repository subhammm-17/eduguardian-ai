// Talks to the FastAPI backend (backend/main.py).
// Every call to the backend lives in this file, so the screens never deal with URLs.
// API keys stay on the server: the browser only keeps a login token.

// Where the backend is running.
// When the backend itself serves these pages (Start EduGuardian.bat, or the online site),
// it's the same address, so "" is enough. Only a separate test server on this computer
// (a different port) needs the usual uvicorn address.
const ON_THIS_COMPUTER = ["127.0.0.1", "localhost"].includes(location.hostname);
export const API_BASE = ON_THIS_COMPUTER && location.port !== "8000" ? "http://127.0.0.1:8000" : "";

// The login token is kept in this browser (localStorage) so you stay signed in
// after closing the tab. It is NOT an API key: it only proves who you are to our backend.
const TOKEN_KEY = "eduguardian_token";
const USER_KEY = "eduguardian_user";

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
}

export function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; } catch (e) { return null; }
}

export function saveLogin(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) {}
}

export function clearLogin() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (e) {}
}

// An error with the HTTP status attached, so screens can tell "logged out" (401) apart.
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

// Turns a FastAPI error ({"detail": ...}) into a readable sentence
async function errorFrom(res) {
  const data = await res.json().catch(() => ({}));
  let message = `Something went wrong (error ${res.status}).`;
  if (typeof data.detail === "string") message = data.detail;
  else if (Array.isArray(data.detail)) {
    // The backend refused the form. Say why in plain words.
    message = data.detail.some((d) => d.type === "string_too_long")
      ? "That is too long. Please make it shorter."
      : "Please fill in every field.";
  }
  return new ApiError(message, res.status);
}

// fetch() with the login token added. A network failure gets a clearer message.
// keepalive: the request still finishes when the page is being closed
async function call(path, { method = "GET", body, keepalive = false } = {}) {
  const headers = { Authorization: `Bearer ${getToken()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const json = body === undefined ? undefined : JSON.stringify(body);
  let res;
  try {
    // Browsers allow keepalive only for small requests (64 KB)
    res = await fetch(API_BASE + path, { method, headers, keepalive: keepalive && (json || "").length < 60000, body: json });
  } catch (e) {
    throw new ApiError(`Can't reach the backend at ${API_BASE}. Is uvicorn running?`, 0);
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

/* ---------- Accounts ---------- */

// role is "student" or "parent"
export async function signup(name, email, password, role = "student") {
  const data = await (await call("/auth/signup", { method: "POST", body: { name, email, password, role } })).json();
  saveLogin(data.token, data.user);
  return data.user;
}

export async function login(email, password) {
  const data = await (await call("/auth/login", { method: "POST", body: { email, password } })).json();
  saveLogin(data.token, data.user);
  return data.user;
}

export async function logout() {
  try { await call("/auth/logout", { method: "POST" }); } catch (e) {}
  clearLogin();
}

// Checks that the saved token still works. Throws an ApiError with status 401 if not.
export async function me() {
  return (await call("/auth/me")).json();
}

/* ---------- Tutoring ---------- */

// Streams an answer. onStart(chatId) is called once the answer starts, and
// onText(fullTextSoFar) each time new words arrive.
// Returns { text, answeredBy, mode, chatId } when the answer is complete.
// body: { subject, question, mode, primary, chat_id, file_id }
// The server saves the question and answer in chat chatId (a new chat when chat_id is empty,
// or when the subject or file changed).
export async function askStream(body, onText, onStart = () => {}) {
  const res = await call("/ask/stream", { method: "POST", body });
  const answeredBy = res.headers.get("X-Answered-By") || "";
  // "guided" when a parent turned on hint mode for this student
  const mode = res.headers.get("X-Answer-Mode") || body.mode;
  const chatId = Number(res.headers.get("X-Chat-Id")) || null;
  onStart(chatId);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  return { text, answeredBy, mode, chatId };
}

// One rung of the hint ladder. level is 1, 2 or 3. The hint is saved in chat chat_id.
export async function getHint({ subject, question, level, primary, chat_id }) {
  return (await call("/hint", { method: "POST", body: { subject, question, level, primary, chat_id } })).json();
}

/* ---------- Chat history (backend/chats.py) ---------- */

// Your saved chats, newest first: [{ id, subject, title, file_name, questions, updated_at }]
export async function listChats() {
  return (await (await call("/chats")).json()).chats;
}

// One chat with its messages: { ..., messages: [{ role, content, mode, answered_by, level }] }
export async function getChat(id) {
  return (await call(`/chats/${id}`)).json();
}

export async function deleteChat(id) {
  await call(`/chats/${id}`, { method: "DELETE" });
}

/* ---------- Your study data (backend/study.py) ---------- */

// Everything the Home page shows: { tasks, roadmap, quizzes, cards, recent_chats }
export async function getStudy() {
  return (await call("/study")).json();
}

export async function saveTasks(tasks) {
  await call("/study/tasks", { method: "POST", body: { tasks }, keepalive: true });
}

// roadmap = null deletes the plan
export async function saveRoadmap(roadmap) {
  await call("/study/roadmap", { method: "POST", body: { roadmap }, keepalive: true });
}

export async function saveQuiz(topic, score, total) {
  await call("/study/quiz", { method: "POST", body: { topic, score, total } });
}

// day is this computer's date, like "2026-10-29"
export async function saveCardReviews(day, count) {
  await call("/study/cards", { method: "POST", body: { day, count }, keepalive: true });
}

// A graph for a maths question, or { image: null } when there is nothing to draw.
export async function getPlot(question) {
  return (await call("/plot", { method: "POST", body: { question } })).json();
}

/* ---------- Syllabus files ---------- */

// Reads a File from the file picker as base64 text, the form the backend expects.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new ApiError("This file could not be read.", 0));
    reader.readAsDataURL(file);
  });
}

// Your uploaded files: [{ id, subject, name, size, uploaded_at }]
export async function listSyllabus() {
  return (await (await call("/syllabus")).json()).files;
}

export async function uploadSyllabus(file, subject) {
  const data = await fileToBase64(file);
  return (await call("/syllabus", { method: "POST", body: { subject, name: file.name, data } })).json();
}

export async function deleteSyllabus(id) {
  await call(`/syllabus/${id}`, { method: "DELETE" });
}

/* ---------- Parental controls (backend/family.py) ---------- */

// For students: { answer_mode: "hints" | "direct" | null, parents: [names] }
export async function familyStatus() {
  return (await call("/family/me")).json();
}

// For students: a one-time code to give to a parent. { code, minutes }
export async function makeParentCode() {
  return (await call("/family/code", { method: "POST" })).json();
}

// For parents
export async function linkChild(code) {
  return (await call("/family/link", { method: "POST", body: { code } })).json();
}

export async function listChildren() {
  return (await (await call("/family/children")).json()).children;
}

export async function childDetails(id) {
  return (await call(`/family/children/${id}`)).json();
}

// answerMode is "hints" or "direct"
export async function setAnswerMode(id, answerMode) {
  return (await call(`/family/children/${id}/mode`, { method: "POST", body: { answer_mode: answerMode } })).json();
}

export async function unlinkChild(id) {
  await call(`/family/children/${id}`, { method: "DELETE" });
}

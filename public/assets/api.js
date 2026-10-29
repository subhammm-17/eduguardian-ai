// Talks to the FastAPI backend (backend/main.py).
// Every call to the backend lives in this file, so the screens never deal with URLs.
// API keys stay on the server: the browser only keeps a login token.

// Where the backend is running.
// When the backend itself serves these pages (Start EduGuardian.bat), it's the same address,
// so "" is enough. Otherwise (e.g. a separate test server) use the usual uvicorn address.
export const API_BASE = location.port === "8000" ? "" : "http://127.0.0.1:8000";

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
async function call(path, { method = "GET", body } = {}) {
  const headers = { Authorization: `Bearer ${getToken()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(API_BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    throw new ApiError(`Can't reach the backend at ${API_BASE}. Is uvicorn running?`, 0);
  }
  if (!res.ok) throw await errorFrom(res);
  return res;
}

/* ---------- Accounts ---------- */

export async function signup(name, email, password) {
  const data = await (await call("/auth/signup", { method: "POST", body: { name, email, password } })).json();
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

// Streams an answer. onText(fullTextSoFar) is called each time new words arrive.
// Returns { text, answeredBy } when the answer is complete.
// body: { subject, question, mode, primary, history: [{ role, content }] }
export async function askStream(body, onText) {
  const res = await call("/ask/stream", { method: "POST", body });
  const answeredBy = res.headers.get("X-Answered-By") || "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  return { text, answeredBy };
}

// One rung of the hint ladder. level is 1, 2 or 3.
export async function getHint({ subject, question, level, primary }) {
  return (await call("/hint", { method: "POST", body: { subject, question, level, primary } })).json();
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

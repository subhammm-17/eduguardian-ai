// Shared by login.html and index.html.

// Where the FastAPI backend is running (uvicorn main:app --reload)
const API_BASE = "http://127.0.0.1:8000";

// The login token is kept in this browser (localStorage) so you stay logged in
// after closing the tab. It is NOT an API key: it only proves who you are to our backend.
const TOKEN_KEY = "eduguardian_token";
const USER_KEY = "eduguardian_user";

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch (e) { return ""; }
}

function getUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; } catch (e) { return null; }
}

function saveLogin(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch (e) {}
}

function clearLogin() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch (e) {}
}

// Turns a FastAPI error ({"detail": ...}) into a readable sentence
async function errorMessage(res) {
  const data = await res.json().catch(() => ({}));
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) return "Please fill in every field.";
  return "Something went wrong (error " + res.status + ").";
}

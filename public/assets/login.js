// Sign-in / sign-up form.
// Accounts live in the FastAPI backend (backend/auth.py, saved in backend/users.db).
import { getToken, getUser, signup, login } from "./api.js";

// Students go to the workspace, parents to the parent dashboard
const homeFor = (user) => (user?.role === "parent" ? "/parent.html" : "/app.html");

(function () {
  // Already signed in? Go straight to the workspace.
  if (getToken()) {
    location.replace(homeFor(getUser()));
    return;
  }

  const params = new URLSearchParams(location.search);
  let mode = params.get("mode") === "signup" ? "signup" : "login";
  let role = params.get("role") === "parent" ? "parent" : "student";

  const el = (id) => document.getElementById(id);
  const form = el("auth-form");
  const error = el("auth-error");

  function render() {
    const signup = mode === "signup";
    el("auth-title").textContent = signup ? "Create your account" : "Sign in";
    el("auth-sub").textContent = signup
      ? (role === "parent" ? "Create a parent account to follow your child's learning." : "Use your university email to get started.")
      : "Welcome back. Continue where you left off.";
    el("name-field").hidden = !signup;
    el("role-field").hidden = !signup;
    document.querySelectorAll("[data-role]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.role === role)));
    el("email-label").textContent = signup && role === "student" ? "University email" : "Email";
    el("pw-hint").hidden = !signup;
    el("password").autocomplete = signup ? "new-password" : "current-password";
    el("auth-submit").textContent = signup ? "Create account" : "Sign in";
    el("auth-switch").innerHTML = signup
      ? 'Already have an account? <button type="button" data-switch>Sign in</button>'
      : 'New to EduGuardian AI? <button type="button" data-switch>Create an account</button>';
    error.hidden = true;
  }

  document.addEventListener("click", (e) => {
    if (e.target.matches("[data-role]")) {
      role = e.target.dataset.role;
      render();
      return;
    }
    if (e.target.matches("[data-switch]")) {
      mode = mode === "signup" ? "login" : "signup";
      render();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = el("email").value.trim();
    const password = el("password").value;
    const name = el("name").value.trim();

    let message = "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) message = "Enter a valid email address.";
    else if (password.length < 8) message = "Password must be at least 8 characters.";
    else if (mode === "signup" && !name) message = "Enter your name.";

    if (message) {
      error.textContent = message;
      error.hidden = false;
      return;
    }

    // Ask the backend to create the account or check the password
    const button = el("auth-submit");
    const label = button.textContent;
    button.disabled = true;
    button.textContent = mode === "signup" ? "Creating account…" : "Signing in…";
    error.hidden = true;
    try {
      const user = mode === "signup" ? await signup(name, email, password, role) : await login(email, password);
      location.href = homeFor(user);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = label;
    }
  });

  render();
})();

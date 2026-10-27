# EduGuardian AI: run it with login and the host's API keys

What changed:
- **Login page** (`frontend/login.html`): students sign up / log in with email + password.
  Accounts are saved in `backend/users.db` (SQLite). Passwords are stored only as a
  one-way hash, never as plain text.
- **No API key boxes any more.** The backend uses the host's own keys from `backend/.env`.
  They are never sent to the browser and never printed. Only logged-in users can ask
  questions, so strangers cannot use up your free quota.
- **New look** (`frontend/index.html` + `frontend/styles.css`): subject cards, a chat-style
  answer list, model + backup pickers next to the Ask button, the "Backup used" tag,
  graphs under maths answers, and a dark mode that follows Windows.

All commands below are for **Git Bash** on Windows.

---

## Step 1: Put the keys in `backend/.env` (only you, only in VS Code)

1. Open VS Code: **File > Open Folder...** and pick `Documents\eduguardian-ai`.
2. In the left panel open `backend` > `.env`.
3. Make sure it has these two lines (your real keys after the `=`, no spaces, no quotes):

   ```
   GEMINI_API_KEY=paste-your-gemini-key-here
   GROQ_API_KEY=paste-your-groq-key-here
   ```

   - Gemini key: https://aistudio.google.com/apikey
   - Groq key (the backup model): https://console.groq.com/keys
   - The Groq line is optional. Without it, there is simply no backup model.
4. Press **Ctrl + S** to save.

**Key safety:** never paste a key into a chat, a screenshot or a commit. `.env` is listed in
`.gitignore`, so Git ignores it. If a key ever leaks, delete it on the provider's website and
make a new one.

Check the keys are found (this prints only the length, never the key):

```bash
cd ~/Documents/eduguardian-ai/backend
source venv/Scripts/activate
python check_env.py
```

You want `found=True` for both lines.

## Step 2: Install the packages (once)

Still in the same Git Bash window (you should see `(venv)` at the start of the line):

```bash
pip install -r requirements.txt
```

Nothing new is needed for login: SQLite and password hashing are built into Python.
This just makes sure `sympy`, `matplotlib` and `numpy` (for graphs) are installed.

## Step 3: Start the backend

```bash
uvicorn main:app --reload
```

Leave this window open. You should see `Uvicorn running on http://127.0.0.1:8000`.
The first start creates `backend/users.db` (the accounts file).

Quick check: open http://127.0.0.1:8000 in your browser. You should see
`"gemini_ready": true`. If it says `false`, go back to Step 1 and then restart uvicorn
(press **Ctrl + C** in that window, then run `uvicorn main:app --reload` again).

## Step 4: Open the website and test it

1. In File Explorer go to `Documents\eduguardian-ai\frontend` and double-click `index.html`.
   You are sent to the login page, because you are not logged in yet.
2. Click **Sign up**, enter a name, email and a password (8+ characters), then **Create account**.
3. You land on the main page. The top right should show a green dot and **Ready**.
4. Click the example **Solve x^2 - 5x + 6 = 0**. The answer should stream in, with a graph
   underneath.
5. Click **Log out**, then log in again with the same email and password.

| What you see | What it means |
|---|---|
| "Could not reach the backend" | Step 3 is not running. |
| Red dot, "Server has no API keys" | `.env` is missing a key. Step 1, then restart uvicorn. |
| "Email or password is incorrect" | Typo, or that account does not exist yet: use **Sign up**. |
| Orange **Backup used** tag | Gemini failed or was slow, so the Groq model answered. |

## Step 5: Save it to GitHub on a new branch (Git Bash window 2)

```bash
cd ~/Documents/eduguardian-ai
git checkout -b login-and-new-ui
git status
```

`git status` must **not** list `backend/.env` or `backend/users.db`
(both are in `.gitignore`). If either appears, stop and ask before going on.

```bash
git add .gitignore backend/main.py backend/auth.py backend/plots.py backend/check_env.py backend/requirements.txt frontend/
git commit -m "Add login, use the host's API keys, and redesign the website"
git push -u origin login-and-new-ui
```

Then on github.com open your repo, click **Compare & pull request**, check the changes,
click **Create pull request**, then **Merge pull request**. Afterwards, back in Git Bash:

```bash
git checkout main
git pull
```

---

## How it works (for your report)

**Login (backend/auth.py)**
1. Sign up saves the email and a *PBKDF2-SHA256 hash* of the password (600,000 rounds plus
   a random salt). A hash is one-way: it can check a password but cannot be turned back into it.
2. Log in creates a random session token (valid 7 days). The browser keeps it in
   `localStorage` and sends it with every request as `Authorization: Bearer <token>`.
3. `/ask`, `/ask/stream` and `/plot` check the token first (`Depends(current_user)`).
   No valid token gives error 401, and the page sends you back to the login page.
4. The database stores only a hash of each token too, so a copied `users.db` cannot be
   used to log in as someone.

**Host keys (backend/main.py)**
- `load_dotenv()` reads `backend/.env`; the keys stay on the server.
- The page never sees a key. `GET /` only reports `gemini_ready` / `backup_ready` (true/false).
- If Gemini fails or gives no answer within 20 seconds and `GROQ_API_KEY` is set,
  the Groq model answers instead and the page shows **Backup used**.

**Formatting** (unchanged): the page takes the maths (`$...$`, `$$...$$`) out, turns the
Markdown into HTML with **marked** (cleaned by **DOMPurify**), then draws the maths with **KaTeX**.

## Changing things later

- **Model list:** add a line inside `<select id="model">` in `index.html`, e.g.
  `<option value="new-model-name">new-model-name</option>`, or pick **Other** on the page.
- **Colours:** change the values at the top of `styles.css` (section 1).
- **Backend address:** `API_BASE` in `frontend/config.js` (change it when you deploy).
- **Before deploying:** restrict `allow_origins` in `main.py` to your website's address.

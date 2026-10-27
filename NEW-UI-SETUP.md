# EduGuardian AI: run the new UI with your backend

The new design lives in `public/`. It now uses your FastAPI backend for:

- **Sign up, sign in and sign out** (same accounts as before, saved in `backend/users.db`).
- **Ask**: answers stream in from Gemini, with Groq as the backup. If you pick
  "Groq · Gemini as backup" in the top bar, Groq answers first.
- **Socratic mode**: the tutor asks guiding questions instead of giving the answer.
- **Hints 1–3** (Nudge, Method, First step) in Socratic mode.
- **Graphs** under maths answers in Normal mode.
- Follow-up questions: the last few messages are sent along, so "why?" makes sense.

Still sample data (from `public/assets/fixtures.js`), because the backend has no
endpoints for them yet: Home dashboard, Flashcards, Quiz, Syllabus and Roadmap.
The **Verified** badge stays off until answer checking with SymPy is added.

Your API keys stay in `backend/.env` on the server. The browser never sees them.

All commands are for **Git Bash** on Windows.

---

## Step 1: Make a new branch (once)

```bash
cd ~/Documents/eduguardian-ai
git checkout -b new-ui
```

Your changes come with you to the new branch. Nothing is committed yet.

## Step 2: Start it (every time)

In File Explorer, open `Documents\eduguardian-ai` and double-click **`Start EduGuardian.bat`**.

- A black window opens and starts the backend. It also serves the website now,
  so there is only one thing to start.
- After a few seconds your browser opens **http://127.0.0.1:8000** by itself.
- Keep the black window open while you study. **Close it to stop** EduGuardian.
- Double-clicked it twice? No problem: it notices it's already running and just opens the browser.

**Tip: a desktop icon.** Right-click `Start EduGuardian.bat` > **Show more options** >
**Send to** > **Desktop (create shortcut)**. Now you can start it from the desktop.

Opening `public\index.html` directly still won't work: the pages must come from the server.

**First time only:** the start file uses the Python environment in `backend\venv`.
You already have it. If it's ever missing, make it in Git Bash:

```bash
cd ~/Documents/eduguardian-ai/backend
python -m venv venv
source venv/Scripts/activate
pip install -r requirements.txt
```

### For coding: the Git Bash way

While you're changing Python code, this restarts the server by itself after every save:

```bash
cd ~/Documents/eduguardian-ai/backend
source venv/Scripts/activate
uvicorn main:app --reload
```

Then open http://127.0.0.1:8000 yourself. (Close the black window first: only one can run at a time.)

## Step 3: Test it

1. On the landing page, click **Open the workspace**. You are sent to the sign-in page, because you are not signed in.
2. Sign in with your existing account, or click **Create an account**.
3. Go to **Ask**, keep **Normal**, and type `Solve x^2 - 5x + 6 = 0`.
   The answer streams in with maths, then a graph appears underneath.
   Under the answer it says which model answered, e.g. "Answered by Gemini (gemini-3.8-flash)".
4. Click **Socratic**, type `I think I should factor it?`. You should get a question back, not the answer.
5. Click **Hint 1 · Nudge**, then **Hint 2**, then **Hint 3**.
6. Open the round account button (top right) and click **Sign out**.

| What you see | What it means |
|---|---|
| "Can't reach the backend" | The black window was closed. Double-click `Start EduGuardian.bat` again. |
| "The server has no API keys in backend/.env yet." | `.env` is missing a key. Fix it, then restart uvicorn (Ctrl + C, run it again). |
| "Email or password is incorrect." | Typo, or the account doesn't exist yet: create one. |
| Answered by Groq (llama-…) | Gemini failed or was slow, so the backup answered. |
| Black window says "address already in use" | Something else (maybe a Git Bash uvicorn) is using port 8000. Close it, then try again. |
| Black window says "Could not find backend\venv" | Do the "First time only" part of Step 2. |
| Browser didn't open | Open http://127.0.0.1:8000 yourself. |
| Blank page | You opened the file directly. Use http://127.0.0.1:8000. |

## Step 4: Save it on the new branch

```bash
cd ~/Documents/eduguardian-ai
git status
git add public backend/main.py NEW-UI-SETUP.md "Start EduGuardian.bat" AGENTS.md PLAN.md README.md netlify.toml
git commit -m "Use the new UI and connect it to the FastAPI backend"
git push -u origin new-ui
```

Check `git status` first: `backend/.env` and `backend/users.db` must **not** be in the list
(they are ignored by `.gitignore`). If you ever see `.env` there, stop and don't commit.

---

## What changed in the code

- `public/assets/api.js` (new): every call to the backend lives here.
  The backend address is the `API_BASE` line at the top.
- `public/assets/login.js`: the form now creates accounts / signs in through the backend.
- `public/assets/app.js`: the workspace needs a login; Ask, hints and graphs call the backend.
- `public/assets/app.css`: styles for the graph image; hint buttons only show in Socratic mode.
- `Start EduGuardian.bat` (new): double-click to start everything and open the browser.
- `backend/main.py`: now also serves the `public/` website at http://127.0.0.1:8000.
  The "is it running?" check moved from `/` to `/health`.
  `/ask` and `/ask/stream` accept `mode` (normal / socratic), `history`
  and `primary` (gemini / groq). New `/hint` endpoint for the hint ladder.

The old `frontend/` folder is untouched (its green "Ready" dot won't work any more, because the check moved to `/health`). Delete it once you're happy.

# Put EduGuardian AI online (free)

This guide puts the website on the internet so your teammates (and later other
students and parents) can use it at the same time, from any phone or laptop.

We use two free services:

| Service | What it does | Why this one |
|---|---|---|
| **Render** (render.com) | Runs the backend, which also serves the website | Runs our FastAPI app straight from GitHub, updates the site by itself after every merge, gives a free `https://…onrender.com` address, and keeps the API keys in a secret settings page. |
| **Neon** (neon.com) | A free Postgres database for accounts, logins, uploaded files and parent links | Render's free servers **wipe their disk** every time they restart or fall asleep, so `users.db` would lose every account. Neon's free database keeps the data and does not expire (Render's own free database is deleted after 30 days). |

Neither needs a credit card for the free plan. You make both accounts and sign
in yourself; nobody else needs your passwords.

> **Key safety.** Your Gemini and Groq keys, and the Neon database address
> (it contains a password), are secrets. Only type them into Render's
> **Environment** page. Never paste them into a chat (including with Claude),
> a screenshot, a commit or a WhatsApp group. If one leaks, delete it on the
> provider's website and make a new one.

---

## Step 1: Merge the pull request and update your computer

1. On GitHub, open the repository, click **Pull requests**, open
   **"Make EduGuardian ready to host online"**, then **Merge pull request** →
   **Confirm merge**.
2. Open **Git Bash** and type:

   ```bash
   cd ~/Documents/eduguardian-ai
   git checkout main
   git pull
   ```

   (Your computer keeps working as before: without `DATABASE_URL` it still
   uses `backend/users.db`. The next double-click on `Start EduGuardian.bat`
   installs the new packages by itself.)

## Step 2: Create the free database on Neon

1. Go to **https://neon.com** and click **Sign up**. Choose **Continue with GitHub**
   (or Google) and allow it.
2. Create a project:
   - **Project name:** `eduguardian`
   - **Postgres version:** leave the default
   - **Region:** **AWS Asia Pacific (Singapore)** (the same region as the website, so it's fast)
   - Click **Create project**.
3. On the project page, click **Connect** (top right).
4. In the box that opens, turn **Connection pooling** **off** (our backend
   keeps its own connections), and leave the rest as it is.
5. Click **Copy snippet** / the copy button next to the address that starts with
   `postgresql://`. Keep this tab open: you paste it into Render in step 3.
   **Don't paste it anywhere else.**

## Step 3: Put the website on Render

1. Go to **https://render.com** and click **Get Started**. Choose **GitHub** and
   sign in. Render asks to install its GitHub app: choose
   **Only select repositories** → `eduguardian-ai` → **Install**.
2. In the Render dashboard, click **New +** → **Blueprint**.
3. Pick the `eduguardian-ai` repository and click **Connect**.
   Render reads the file `render.yaml` from the repository, which already says
   how to build and start the site.
4. Give the Blueprint a name (for example `eduguardian`). Render now asks for
   three secret values. Fill them in:
   - **GEMINI_API_KEY:** open `backend/.env` in VS Code and copy the text after
     `GEMINI_API_KEY=` (only the key, no spaces or quotes).
   - **GROQ_API_KEY:** the same, the text after `GROQ_API_KEY=`.
   - **DATABASE_URL:** the `postgresql://…` address you copied from Neon.
5. Click **Deploy Blueprint** (or **Apply**). The first build takes about
   5 to 10 minutes. You can watch it under **Logs**.
6. When the logs say `Application startup complete` and the status is **Live**,
   click the address at the top, something like
   `https://eduguardian-ai.onrender.com`.
7. Check it works: open `https://<your address>/health`. It should say
   `"gemini_ready": true` and `"backup_ready": true`. Then sign up on the site
   and ask one question.

## Step 4: Share it

Send the `https://…onrender.com` address to your teammates. Each person signs
up with their own email and password. Parents make a **parent** account and
link to a student with the student's one-time code, as on your computer.

## Updating the site later

You don't need to do anything on Render. Every time a pull request is merged
into `main`, Render builds and restarts the site by itself (about 3 to 5 minutes).
Accounts and files stay, because they live in Neon.

To change a key: Render dashboard → the `eduguardian-ai` service →
**Environment** → edit the value → **Save, rebuild, and deploy**.

---

## Free plan limits (please read)

- **The site falls asleep.** After **15 minutes** with no visitors, Render stops
  the server. The next visitor waits **about a minute** while it wakes up, then
  it is fast again. Before a demo, open the site a minute early.
  (Optional: a free monitor such as UptimeRobot can open `/health` every
  10 minutes to keep it awake. One always-on site uses about 744 of the 750 free
  hours a month, so don't do this for a second site.)
- **Small server.** The free server has 512 MB of memory and a small share of
  one CPU. Logging in takes a few seconds (passwords are checked slowly on
  purpose, for safety), and drawing graphs is slower than on your laptop.
  A handful of people at the same time is fine; a whole class at once will be slow.
- **Bandwidth:** 5 GB a month on the free workspace. That is thousands of visits,
  but if it runs out, Render pauses the site until next month.
- **Database:** Neon's free plan holds 1 GB. Each student can keep up to
  30 files and 50 MB of uploads. The database also naps after 5 quiet minutes
  and wakes in under a second.
- **AI cost: the biggest limit.** Every question uses **your** Gemini and Groq
  keys. Free keys have a small number of requests per minute and per day
  **for everyone together**, so with many users they run out quickly (the site
  then switches to the backup model, and later shows a "model error").
  The backend already limits each user to 15 questions a minute and 300 a day
  (`ASK_PER_MINUTE` / `ASK_PER_DAY` in `backend/main.py`). Before opening it to
  many students and parents, lower those numbers or move to a paid key with a
  spending cap.
- **One server only.** Rate limits are counted in the server's memory. That's
  right for one free server; don't raise the number of instances.

## How the online version stays safe

These are already set up in the code and in `render.yaml`:

- **HTTPS only.** Render gives the site a certificate, and the backend tells
  browsers to always use HTTPS (`Strict-Transport-Security`).
- **CORS and CSP are stricter online.** With `EDUGUARDIAN_HOSTED=1`, only the
  site itself may call the backend: localhost addresses are no longer allowed,
  and the Content Security Policy only lets pages talk to their own address.
- **Real visitor addresses for rate limits.** Behind Render's proxy every
  visitor would look the same, so login and sign-up limits would block
  everyone at once. `CLIENT_IP_HEADER=CF-Connecting-IP` reads the visitor's
  real address from a header that visitors can't fake.
  (People on the same college Wi-Fi may share one address: at most 10 new
  accounts per hour per address.)
- **Secrets stay in Render.** The keys and the database address are only in
  Render's Environment page, never in GitHub, never sent to the browser, and
  hidden in error messages.

## If something goes wrong

| What you see | What to do |
|---|---|
| Build fails with a `pip` error | Open **Logs**, copy the red lines (they contain no keys) and ask for help. |
| `/health` says `"gemini_ready": false` | The key is missing: **Environment** → check `GEMINI_API_KEY` → **Save, rebuild, and deploy**. |
| "couldn't get a connection" in the logs | `DATABASE_URL` is wrong. Copy it again from Neon (**Connect**, pooling off) and save it in **Environment**. |
| The page loads slowly the first time | It was asleep. Wait about a minute. |
| "Too many login attempts" for everyone | Check `CLIENT_IP_HEADER` is `CF-Connecting-IP` in **Environment**. |
| Accounts disappear after a while | `DATABASE_URL` isn't set, so the site fell back to a file on Render's disk. Set it as in step 3. |

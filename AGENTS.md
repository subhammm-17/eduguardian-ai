# AGENTS.md

## Start here
Continue from **PLAN.md**. Milestone 1 (the product surface) is done. Pick up the next unchecked milestone.

## Architecture
- Static site with no build step, published from `public/` (see `netlify.toml`).
- `public/index.html`: landing page. `public/login.html` + `assets/login.js`: sign-in UI. For now it stores a preview profile in `sessionStorage` (`eg_user`).
- `public/app.html`: workspace shell. Every view is a `<section data-view="…">`. Hash routing (`#home`, `#ask`, `#syllabus`, `#study`, `#roadmap`) lives in `route()` in `assets/app.js`.
- `assets/app.js`: an ES module organised by screen (top bar, home, ask, flashcards, quiz).
- `assets/fixtures.js`: **all sample data**. When adding real APIs, replace these exports or the functions that read them (`pickReply`, `loadDeck`, `startQuiz`, `renderHome`) instead of scattering fetch calls through the UI.
- Syllabus uploads: `backend/syllabus.py` (`/syllabus` list, upload, delete). Files are sent as base64 JSON (no python-multipart needed), saved in `backend/uploads/<user id>/` (gitignored) and listed in `users.db`. One shared file picker (`#syllabus-input`) serves every `[data-upload-syllabus]` button.
- Parental controls: `backend/family.py` (`/family/*`). Accounts have a `role` (`student` or `parent`, column in `users`). A student makes a one-time 8-letter code (account menu → Parent link); the parent types it on `public/parent.html` (`assets/parent.js`). Each link stores an `answer_mode` (`hints` by default, or `direct`). When any linked parent chose `hints`, `main.py` turns a "normal" question into `guided` and adds `GUIDED_RULES` (concept + hints + partial steps, never the final answer) before and a reminder after the question; `/plot` returns no graph. Questions and hints are logged in `activity`, and the roadmap progress is sent to `/family/progress`, for the parent dashboard.
- Today's plan tasks are saved in the browser (`localStorage`, key `eduguardian_tasks`), seeded from `TODAY_TASKS` the first time. Add/delete live in the card's "Edit plan" drop-down.
- Roadmap: `buildRoadmap()` turns a template + form answers into week sections (the 2-week template stretches to the exam date); ticks, added and deleted tasks are saved in `localStorage` (`eduguardian_roadmap`) and feed the Home "Roadmap progress" stat.
- `app.html` loads CSS/JS with `?v=N` and the backend sends `Cache-Control: no-cache`, so a `git pull` shows up without clearing the browser cache. Bump N when changing assets.
- Database: `backend/db.py`. SQLite (`backend/users.db`) locally; Postgres when `DATABASE_URL` is set (online, on Neon). Write SQLite-style SQL with `?` and `with _db() as conn:`; db.py translates for Postgres. Use `RETURNING id` instead of `cursor.lastrowid`, `add_column()` for migrations, and index rows (`row[0]`) instead of unpacking them. Uploaded files live in the database (`syllabus_files.content`), not on disk, because free hosts wipe their disk.
- Hosting: Render free web service from `render.yaml` (guide: `DEPLOY.md`). `EDUGUARDIAN_HOSTED=1` drops localhost from CORS/CSP and adds HSTS; `CLIENT_IP_HEADER=CF-Connecting-IP` gives rate limits the real visitor IP. Secrets (`GEMINI_API_KEY`, `GROQ_API_KEY`, `DATABASE_URL`) are only in Render's Environment page.
- Styles: `assets/styles.css` (tokens + shared components), `assets/site.css` (public pages), `assets/app.css` (workspace).

## Conventions
- Keep it plain HTML/CSS/JS: the project owner is a beginner and asked for no build step. Add libraries only from a CDN with a pinned version.
- Design is deliberately restrained: a single warm dark theme (dark brown surfaces, deep red `--accent: #a8262e`, pastel yellow `--highlight`/`--accent-text: #f4d67a`), IBM Plex Sans for UI, Source Serif 4 for headings, and no decorative gradients. No light mode; colours live only as tokens in `styles.css`.
- Model output is Markdown with `$…$` / `$$…$$` maths. Always render it through `rich()` in `app.js`, which extracts the maths before Markdown parsing, sanitises with DOMPurify, then renders the maths with KaTeX.
- Tables and diagrams in answers: the model writes Markdown tables, ```logic blocks (Boolean equations, drawn as gate circuits by `assets/circuits.js`) and ```mermaid blocks (flowcharts, loaded from a pinned CDN only when needed). ```figure blocks (e.g. `bloch theta=90 phi=0 label=|+⟩`) are drawn by `answerFigure()` in `assets/figures.js`; Mermaid blocks that try to show a Bloch sphere are swapped for that figure, and Mermaid that still fails folds into a short "couldn't be drawn" note. The rules live in `FORMAT_RULES` in `backend/main.py`. Never let the model draw ASCII art.
- Accessibility: labelled controls, visible focus, keyboard shortcuts on flashcards (Space, arrow keys, 1–4), and a bottom tab bar below 760px.
- Short, plain comments that a beginner can follow.
- Security lives in `backend/security.py` (rate limits, security headers incl. a Content Security Policy, request size limit, CORS origins, `scrub()` for error text). The CSP blocks inline `<script>` blocks and `on…=` attributes, and only allows scripts from our own server and `cdn.jsdelivr.net`: put page code in `public/assets/*.js`, and add an `integrity` hash when adding a CDN `<script>`. Keep `netlify.toml` headers in step with `security.py`.
- The backend picks the AI models (`GEMINI_MODEL` / `GROQ_MODEL` in `backend/.env`, else the defaults in `main.py`); requests naming any other model are refused so nobody can spend the host's credit on expensive models. `/docs` is off unless `EDUGUARDIAN_DOCS=1`.

## Non-obvious decisions
- Socratic mode is a toggle inside Ask, not a separate nav item. This keeps the sidebar to five entries.
- The original brief describes a FastAPI + SQLite backend. On Netlify, it maps to Functions + Identity + Netlify Database + AI Gateway. SymPy verification needs a decision (see PLAN.md, milestone 4).
- API keys never reach the browser. AI calls go through server functions only.

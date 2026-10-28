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
- Today's plan tasks are saved in the browser (`localStorage`, key `eduguardian_tasks`), seeded from `TODAY_TASKS` the first time. Add/delete live in the card's "Edit plan" drop-down.
- Roadmap: `buildRoadmap()` turns a template + form answers into week sections (the 2-week template stretches to the exam date); ticks, added and deleted tasks are saved in `localStorage` (`eduguardian_roadmap`) and feed the Home "Roadmap progress" stat.
- `app.html` loads CSS/JS with `?v=N` and the backend sends `Cache-Control: no-cache`, so a `git pull` shows up without clearing the browser cache. Bump N when changing assets.
- Styles: `assets/styles.css` (tokens + shared components), `assets/site.css` (public pages), `assets/app.css` (workspace).

## Conventions
- Keep it plain HTML/CSS/JS: the project owner is a beginner and asked for no build step. Add libraries only from a CDN with a pinned version.
- Design is deliberately restrained: a single warm dark theme (dark brown surfaces, deep red `--accent: #a8262e`, pastel yellow `--highlight`/`--accent-text: #f4d67a`), IBM Plex Sans for UI, Source Serif 4 for headings, and no decorative gradients. No light mode; colours live only as tokens in `styles.css`.
- Model output is Markdown with `$…$` / `$$…$$` maths. Always render it through `rich()` in `app.js`, which extracts the maths before Markdown parsing, sanitises with DOMPurify, then renders the maths with KaTeX.
- Tables and diagrams in answers: the model writes Markdown tables, ```logic blocks (Boolean equations, drawn as gate circuits by `assets/circuits.js`) and ```mermaid blocks (flowcharts, loaded from a pinned CDN only when needed). The rules live in `FORMAT_RULES` in `backend/main.py`. Never let the model draw ASCII art.
- Accessibility: labelled controls, visible focus, keyboard shortcuts on flashcards (Space, arrow keys, 1–4), and a bottom tab bar below 760px.
- Short, plain comments that a beginner can follow.

## Non-obvious decisions
- Socratic mode is a toggle inside Ask, not a separate nav item. This keeps the sidebar to five entries.
- The original brief describes a FastAPI + SQLite backend. On Netlify, it maps to Functions + Identity + Netlify Database + AI Gateway. SymPy verification needs a decision (see PLAN.md, milestone 4).
- API keys never reach the browser. AI calls go through server functions only.

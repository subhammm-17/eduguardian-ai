# EduGuardian AI

A study companion for university students in mathematics, digital logic and quantum computing. It explains concepts, offers a Socratic mode that guides students through problems without giving the answer away, generates flashcards and quizzes, and verifies mathematical results with a symbolic solver.

## What's here

- **Landing page** (`public/index.html`): product overview.
- **Sign in / sign up** (`public/login.html`): form with validation. Not connected to real accounts yet.
- **Workspace** (`public/app.html`):
  - **Home:** dashboard with cards due, last quiz score and roadmap progress.
  - **Ask:** Normal and Socratic modes with a hint ladder, plus streamed Markdown and maths answers.
  - **Study:** flashcards with spaced repetition, and timed or untimed quizzes with feedback.
  - **Syllabus** and **Roadmap**: previews of upcoming features.

The workspace currently runs on sample data from `public/assets/fixtures.js`.

## Technology

- Plain HTML, CSS and JavaScript (ES modules) with no build step.
- CDN libraries with pinned versions: marked (Markdown), DOMPurify (sanitising), KaTeX (maths).
- Hosted on Netlify. Planned backend: Netlify Functions, Netlify Identity, Netlify Database, Netlify Blobs and Netlify AI Gateway.

## Run locally

```bash
netlify dev
```

Then open the URL it prints. Any static file server pointed at `public/` also works.

## Put it online

See [DEPLOY.md](./DEPLOY.md): free hosting on Render, with a free Neon database so accounts survive restarts.

## Roadmap

See [PLAN.md](./PLAN.md). The next milestones are accounts, the tutoring API with Socratic safety checks, answer verification, syllabus chat (RAG), generated flashcards and quizzes, and the roadmap builder.

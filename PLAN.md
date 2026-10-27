# EduGuardian AI — Product roadmap

EduGuardian AI is a study companion for maths, digital logic and quantum computing. It offers Socratic tutoring, notes-grounded answers, flashcards and quizzes, and study roadmaps. Mathematical results are verified with a symbolic solver wherever possible.

The product is built in small, self-contained milestones. Each one ships something a student can use.

## Milestone 1: Product surface ✅
- Landing page, sign-in/sign-up screen and app workspace (sidebar, which becomes a bottom tab bar on phones; top bar with subject, model and account menu).
- **Home:** cards due, last quiz score, roadmap progress, today's tasks, recent questions.
- **Ask:** Normal / Socratic toggle, three-step hint ladder, streamed Markdown + KaTeX answers, Socratic and Verified badges.
- **Study:** flashcards with 3D flip, keyboard shortcuts and Leitner boxes; quizzes with difficulty, question count, optional timer, instant feedback, score screen and "review my mistakes".
- **Syllabus** and **Roadmap**: preview screens.
- All data comes from `public/assets/fixtures.js`.

## Milestone 2: Accounts
- Replace the preview sign-in in `public/assets/login.js` with Netlify Identity (`@netlify/identity`): email + password sign-up, login, logout and password recovery.
- Gate `app.html` behind login, and protect every function so it checks the signed-in user.

## Milestone 3: Tutoring API (Ask + Socratic)
- `netlify/functions/ask.ts`: streams answers through Netlify AI Gateway (Gemini first, with an automatic fallback model). Model names come from environment variables with sensible defaults.
- The request takes `mode: "normal" | "socratic"`, the subject and the last few conversation turns. Subject prompts are ported from the original `SUBJECT_PROMPTS`.
- Socratic safety check: when a reply reveals the final answer, regenerate it once with a stricter instruction.
- Hints are generated per level (nudge → method → first step). No level reveals the final answer.
- Swap `pickReply()` in `app.js` for the streaming call.

## Milestone 4: Answer verification
- Decide how SymPy runs, because Netlify Functions run JavaScript/TypeScript:
  (a) keep a small Python verification service, or
  (b) use a JavaScript CAS such as `nerdamer` or `mathjs` for equations, derivatives and integrals.
- Apply the check to tutoring answers, quiz answers and the Socratic "contains final answer" test. Show **Verified** only when the solver and the model agree.
- Graphs under maths answers (the original `/plot` feature).

## Milestone 5: Data model
- Netlify Database (Postgres + Drizzle) tables: `documents`, `chunks` (text, page, embedding), `flashcards` (box, due date), `quiz_attempts`, `roadmaps`, `roadmap_tasks`.
- Uploaded files (PDF/txt) are stored in Netlify Blobs.

## Milestone 6: Chat with Syllabus (RAG)
- Upload endpoint: extract PDF text, split it into chunks of 500–800 words with overlap, and embed each chunk.
- Retrieve the top 4–5 chunks by cosine similarity, falling back to keyword search when embeddings are unavailable.
- Answers cite their sources as [n] chips that open the snippet (file name + page). The reply says clearly when the notes don't cover the question.
- "My notes only" vs "Notes + general knowledge" modes.
- Build the full Syllabus screen: drag-and-drop upload with progress, document list with delete.

## Milestone 7: Generated flashcards and quizzes
- Generate cards and quizzes from a topic or from syllabus chunks as strict JSON, validated with a schema and retried once.
- Save Leitner progress and quiz attempts per user. Feed the Home dashboard from real data.

## Milestone 8: Study Roadmap Builder
- Form → JSON plan (weeks → days → tasks with time and resource type) that fits before the exam date, with revision days at the end.
- Timeline view with checkboxes, overall progress, and "Make flashcards" / "Take a quiz" links that open Study with the topic filled in.
- Regenerate, and export as PDF through print styles.

## Milestone 9: Polish
- Error toasts for network failures, empty states driven by real data, an accessibility pass and print styles.

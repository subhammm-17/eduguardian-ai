# Dashboard page: how to run it and save it to GitHub

The page is already saved in your project at
`C:\Users\Subham\Documents\eduguardian-ai\frontend\index.html`.
It talks to your FastAPI backend, so the backend must be running first.

## Step 1: Start the backend (Git Bash window 1)

```bash
cd ~/Documents/eduguardian-ai/backend
source venv/Scripts/activate
uvicorn main:app --reload
```

Leave this window open. You should see `Uvicorn running on http://127.0.0.1:8000`.

## Step 2: Open the page

In File Explorer go to `Documents\eduguardian-ai\frontend` and double-click `index.html`.
It opens in your browser. (You need internet, because the page loads its formatting
libraries from the web.)

Then: pick **Mathematics**, keep **gemini-3.8-flash**, paste your key into the key box
(on the page only, never in a chat), type a question, and press **Ask**.

If you see "Could not reach the backend", Step 1 is not running.

**Key safety:** the key is kept only in that browser tab (sessionStorage) and is gone when
you close the tab. It is not written into `index.html`, so it can never be committed.

## Step 3: Save it to GitHub on a new branch (Git Bash window 2)

```bash
cd ~/Documents/eduguardian-ai
git status
```

`git status` should show `frontend/` as new. Make sure **no `.env` file** is listed.
(If `backend/main.py` is also listed as changed, commit it first on the branch you were
using for the backend, before the next commands.)

```bash
git checkout -b frontend-dashboard
git add frontend/index.html
git commit -m "Add dashboard page with formatted Markdown and maths answers"
git push -u origin frontend-dashboard
```

Then open your repo on github.com, click **Compare & pull request**, then **Create pull
request**, then **Merge**. Afterwards, back in Git Bash:

```bash
git checkout main
git pull
```

## How the formatting works (for your report)

The model replies in Markdown with LaTeX maths. The page:
1. takes the maths (`$...$` and `$$...$$`) out and keeps it aside,
2. turns the Markdown (headings, bold, lists) into HTML with **marked**, cleaned by **DOMPurify**,
3. draws the maths back in with **KaTeX**.

This order matters: if Markdown runs first it breaks the backslashes and underscores
inside the maths.

## Changing the model list

Model names change often. Pick **Other (type a model name)** in the model dropdown to try
any other model name, or add a line like this inside `<select id="model">` in `index.html`:

```html
<option value="new-model-name">new-model-name</option>
```

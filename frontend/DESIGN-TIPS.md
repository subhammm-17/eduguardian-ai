# How to design a better interface (beginner guide)

## The 6 ideas used in the new page

1. **Group things into steps.** The page reads like a recipe: 1. Subject, 2. Model and key,
   3. Your question. Students never wonder what to do next.
2. **Settings on the left, work on the right.** Things you set once (subject, model, key) sit in
   a side column. The question and answer get the big space. On a phone the columns stack.
3. **Cards.** Each group is a white box with rounded corners and a soft shadow. Cards make a
   page look tidy without extra effort.
4. **Few colours, used with meaning.** One brand colour (indigo) for "click me" and the
   selected subject. Green only for "safe/verified", orange for warnings, red for errors.
   All colours live at the top of the `<style>` block in `:root`, so you can re-theme the whole
   site by changing a few lines. Dark mode switches automatically with Windows' setting.
5. **Show what is happening.** Grey shimmering bars while the model thinks, a clear red box
   for errors, a friendly empty state before the first question.
6. **Help people start.** Example questions under the box (click to fill), a Copy button on the
   answer, and Ctrl + Enter to send.

## Ready for your next feature: the "Verified" badge

The page already has the styles for a green **✓ Verified** and an orange **⚠ Could not verify**
badge (`.badge.ok` and `.badge.fail`). When we add the SymPy check, the backend will send the
result and we will switch the badge on.

## Easy things to try yourself (good practice)

- Change `--accent: #4f46e5;` to `#0d9488` (teal) and refresh the page.
- Edit the example questions in the `EXAMPLES` list near the top of the `<script>`.
- Add a model: copy an `<option ...>` line inside `<select id="model">`.

Refresh the browser (F5) after each change to see it.

## How to learn more design

- Look at sites you like (ChatGPT, Notion, Khan Academy) and copy the *layout idea*, not the code.
- Draw the page on paper first: boxes for each part, then build it.
- Keep spacing consistent: this page uses multiples of 4px (8, 12, 16, 20, 24).
- In the browser press **F12**, click the arrow icon, and click any part of the page to see
  and live-edit its CSS. Nothing is saved, so it is a safe playground.

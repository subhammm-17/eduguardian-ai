// Ready-made content for the workspace: subjects, suggestions, templates,
// starter flashcard decks and practice quiz questions.
// Your own data (chats, plan, roadmap, scores) is NOT here: it is saved on the
// server for each account (backend/chats.py and backend/study.py), so a new
// account starts empty instead of showing made-up numbers.

export const SUBJECTS = [
  { id: "maths", name: "Mathematics" },
  { id: "digital_logic", name: "Digital logic" },
  { id: "quantum", name: "Quantum computing" },
];

export const MODELS = [
  { id: "gemini", label: "Gemini", backup: "Groq" },
  { id: "groq", label: "Groq", backup: "Gemini" },
];

// Suggested prompts shown in the empty Ask screen.
export const SUGGESTIONS = {
  maths: ["Solve x² − 5x + 6 = 0", "Differentiate x² · sin(x)", "What is an eigenvalue?"],
  digital_logic: ["Simplify A·B + A·B'", "Explain a 2-to-1 multiplexer", "How does a JK flip-flop work?"],
  quantum: ["What does a Hadamard gate do?", "Explain superposition simply", "What is entanglement?"],
};

// Prompt templates in Ask. Text in [square brackets] is a gap to fill in;
// the first gap is selected when a template is picked.
export const PROMPT_TEMPLATES = [
  { label: "Explain step by step", text: "Explain step by step how to [solve this problem]." },
  { label: "Check my working", text: "Here is my working for [the problem]:\n[your steps]\nWhere did I go wrong?" },
  { label: "Practice question", text: "Give me one practice question on [topic] at medium difficulty. Don't show the answer yet." },
  { label: "Compare two ideas", text: "What is the difference between [idea A] and [idea B]?" },
  { label: "Revision summary", text: "Summarise [topic] in five key points for revision." },
  { label: "Explain simply", text: "Explain [concept] simply, with one everyday example." },
];

// Normal-mode answers (Markdown with $…$ maths). `verified` marks results checked by the solver.
// Callout boxes: start a quote with [!definition], [!formula], [!example], [!tip] or [!mistake].
// `figure` names a diagram from figures.js, shown under the answer with its `caption`.
export const ANSWERS = {
  maths: {
    match: [
      {
        keys: ["x²", "x^2", "5x", "quadratic", "solve"],
        verified: true,
        figure: "parabola",
        caption: "The graph crosses the x-axis at the two roots.",
        text: `To solve $x^2 - 5x + 6 = 0$, factorise the left-hand side.

**1. Find two numbers** that multiply to $6$ and add to $-5$: these are $-2$ and $-3$.

**2. Write the factors:**

$$(x - 2)(x - 3) = 0$$

**3. Set each factor to zero:** $x - 2 = 0$ or $x - 3 = 0$.

> [!example] **Answer:** $x = 2$ or $x = 3$.

> [!tip] Check by substitution: $2^2 - 5 \\cdot 2 + 6 = 0$ and $3^2 - 5 \\cdot 3 + 6 = 0$.`,
      },
      {
        keys: ["differentiate", "derivative", "sin"],
        verified: true,
        figure: "product",
        caption: "The function being differentiated, y = x² sin x.",
        text: `Use the **product rule**.

> [!formula] If $f = u \\cdot v$, then $f' = u'v + uv'$.

- $u = x^2$, so $u' = 2x$
- $v = \\sin x$, so $v' = \\cos x$

$$\\frac{d}{dx}\\left(x^2 \\sin x\\right) = 2x \\sin x + x^2 \\cos x$$

> [!mistake] Don't multiply the two derivatives: $(uv)' \\neq u'v'$.`,
      },
    ],
    fallback: {
      verified: false,
      figure: "eigen",
      caption: "Multiplying by A stretches the eigenvector v but turns the ordinary vector w.",
      text: `> [!definition] An **eigenvalue** $\\lambda$ of a square matrix $A$ is a number for which there is a non-zero vector $v$ with $A v = \\lambda v$.

The vector $v$ is the matching **eigenvector**: multiplying by $A$ only stretches or shrinks it, without changing its direction.

> [!formula] To find eigenvalues, solve the characteristic equation $\\det(A - \\lambda I) = 0$.

> [!mistake] The zero vector never counts as an eigenvector, even though $A \\cdot 0 = \\lambda \\cdot 0$.`,
    },
  },
  digital_logic: {
    match: [],
    fallback: {
      verified: false,
      figure: "kmap2",
      caption: "Both cells in row A hold 1, so the group covers all of A whatever B is.",
      text: `Apply the **distributive law** and then the **complement law**:

$$A \\cdot B + A \\cdot B' = A \\cdot (B + B') = A \\cdot 1 = A$$

> [!formula] Complement law: $B + B' = 1$ for any input $B$.

So the expression simplifies to **A**.

> [!tip] On a Karnaugh map, the two terms are adjacent cells that differ only in $B$, which is why $B$ drops out.`,
    },
  },
  quantum: {
    match: [],
    fallback: {
      verified: false,
      figure: "hadamard",
      caption: "A one-qubit circuit: prepare |0⟩, apply H, then measure.",
      text: `> [!definition] The **Hadamard gate** $H$ puts a basis state into an equal superposition.

$$H|0\\rangle = \\frac{|0\\rangle + |1\\rangle}{\\sqrt{2}}, \\qquad H|1\\rangle = \\frac{|0\\rangle - |1\\rangle}{\\sqrt{2}}$$

> [!example] Measuring $H|0\\rangle$ gives $0$ or $1$ with probability $\\tfrac{1}{2}$ each.

> [!tip] Applying $H$ twice returns the original state, because $H^2 = I$.`,
    },
  },
};

// Socratic replies: one guiding question at a time, never the final answer.
export const SOCRATIC = {
  maths: {
    open: `Let's work through it together rather than jumping to the answer.

The equation $x^2 - 5x + 6 = 0$ is a quadratic. Quadratics can often be **factorised** into two brackets of the form $(x - a)(x - b)$.

**Question:** if you expand $(x - a)(x - b)$, what do you get?`,
    followUp: `Good, you're thinking about it. Compare your expansion with $x^2 - 5x + 6$.

**Question:** what must $a + b$ and $a \\cdot b$ equal for the two expressions to match?`,
  },
  digital_logic: {
    open: `Let's simplify it step by step.

Both terms share a common variable. **Question:** which variable appears in both $A \\cdot B$ and $A \\cdot B'$, and what law lets you take it outside a bracket?`,
    followUp: `That's the right direction. Once it's factored out, look at what's left inside the bracket.

**Question:** what is the value of $B + B'$ for any input?`,
  },
  quantum: {
    open: `Let's reason it out. Start from what a gate does: it is a matrix acting on a state vector.

**Question:** how would you write $|0\\rangle$ as a column vector?`,
    followUp: `Right idea. Now multiply the Hadamard matrix $\\frac{1}{\\sqrt{2}}\\begin{pmatrix}1 & 1\\\\ 1 & -1\\end{pmatrix}$ by that vector.

**Question:** what are the two entries of the result?`,
  },
};

export const HINTS = {
  maths: [
    "Look for two numbers with a specific product and a specific sum.",
    "Method: write $x^2 + bx + c$ as $(x - p)(x - q)$, where $p + q = -b$ and $p \\cdot q = c$.",
    "First step: list the factor pairs of $6$: $(1, 6)$ and $(2, 3)$, including their negatives. Check which pair adds to $-5$.",
  ],
  digital_logic: [
    "Both terms have something in common.",
    "Method: use the distributive law $X \\cdot Y + X \\cdot Z = X \\cdot (Y + Z)$.",
    "First step: rewrite the expression as $A \\cdot (B + B')$. Now think about the complement law.",
  ],
  quantum: [
    "Think of the gate as a 2×2 matrix and the state as a 2-entry vector.",
    "Method: write $|0\\rangle = \\begin{pmatrix}1\\\\0\\end{pmatrix}$ and use matrix–vector multiplication.",
    "First step: the first entry of the result is $\\frac{1}{\\sqrt{2}}(1 \\cdot 1 + 1 \\cdot 0)$. Compute the second entry the same way.",
  ],
};

export const HINT_LABELS = ["Nudge", "Method", "First step"];

// Flashcard decks. `box` is the Leitner box (1 = review often, 5 = well known).
// `figure` (optional) shows a diagram on the answer side.
// Decks with `template: true` are ready-made starter decks.
export const DECKS = [
  {
    id: "linalg",
    name: "Linear algebra",
    cards: [
      { front: "What is an eigenvector of $A$?", back: "A non-zero vector $v$ such that $Av = \\lambda v$ for some scalar $\\lambda$.", figure: "eigen", box: 1 },
      { front: "How do you find the eigenvalues of $A$?", back: "Solve the characteristic equation $\\det(A - \\lambda I) = 0$.", box: 2 },
      { front: "What is the determinant of $\\begin{pmatrix}a & b\\\\ c & d\\end{pmatrix}$?", back: "$ad - bc$", box: 3 },
      { front: "When is a square matrix invertible?", back: "When its determinant is non-zero.", box: 1 },
      { front: "What is the rank of a matrix?", back: "The number of linearly independent rows (equivalently, columns).", box: 2 },
    ],
  },
  {
    id: "boolean",
    name: "Boolean algebra",
    cards: [
      { front: "State De Morgan's first law.", back: "$(A + B)' = A' \\cdot B'$", box: 2 },
      { front: "Simplify $A + A \\cdot B$.", back: "$A$ (absorption law)", box: 1 },
      { front: "What is $A \\oplus A$?", back: "$0$", box: 3 },
      { front: "How many cells does a 4-variable Karnaugh map have?", back: "$16$", figure: "kmap4", box: 1 },
    ],
  },
  {
    id: "quantum-starter",
    name: "Quantum basics",
    template: true,
    cards: [
      { front: "What does $H|0\\rangle$ equal?", back: "$\\frac{|0\\rangle + |1\\rangle}{\\sqrt{2}}$, written $|+\\rangle$", figure: "bloch", box: 1 },
      { front: "What is $H^2$?", back: "The identity $I$", box: 1 },
      { front: "How many amplitudes describe two qubits?", back: "$4$, one for each of $|00\\rangle, |01\\rangle, |10\\rangle, |11\\rangle$", box: 1 },
      { front: "What does measuring a qubit do?", back: "It returns $0$ or $1$ and leaves the qubit in that basis state.", box: 1 },
    ],
  },
  {
    id: "calculus-starter",
    name: "Calculus rules",
    template: true,
    cards: [
      { front: "Product rule", back: "$(uv)' = u'v + uv'$", box: 1 },
      { front: "Chain rule", back: "$\\frac{d}{dx} f(g(x)) = f'(g(x)) \\cdot g'(x)$", box: 1 },
      { front: "Derivative of $\\sin x$", back: "$\\cos x$", box: 1 },
      { front: "Roots of $x^2 - 5x + 6$", back: "$x = 2$ and $x = 3$", figure: "parabola", box: 1 },
    ],
  },
];

// Quiz templates: one click fills the quiz setup form.
export const QUIZ_TEMPLATES = [
  { id: "quick", name: "Quick check", desc: "3 easy questions, no timer", topic: "Linear algebra and calculus basics", difficulty: "Easy", count: 3, timer: false },
  { id: "warmup", name: "Exam warm-up", desc: "5 medium questions, no timer", topic: "Linear algebra and calculus basics", difficulty: "Medium", count: 5, timer: false },
  { id: "mock", name: "Timed mock test", desc: "6 hard questions, 60 seconds each", topic: "Linear algebra and calculus basics", difficulty: "Hard", count: 6, timer: true },
];

// Roadmap templates: the shape of a plan before it is generated for you.
export const ROADMAP_TEMPLATES = [
  {
    id: "two-week",
    name: "2-week exam revision",
    desc: "Cover every topic once, practise, then revise.",
    hours: 2,
    weeks: [
      { title: "Week 1 · Learn", tasks: ["Read notes for one topic a day", "10 flashcards after each topic", "Short quiz on Friday"] },
      { title: "Week 2 · Practise and revise", tasks: ["Past-paper questions, 45 minutes a day", "Review every flashcard in box 1–2", "Timed mock test two days before the exam", "Rest day before the exam"] },
    ],
  },
  {
    id: "daily-20",
    name: "Daily 20-minute review",
    desc: "A light routine to keep topics fresh all term.",
    hours: 0.5,
    weeks: [
      { title: "Every day", tasks: ["10 minutes of due flashcards", "One practice question in Ask", "Note one thing you found hard"] },
      { title: "Every Sunday", tasks: ["Quick check quiz (3 questions)", "Move weak topics to next week's plan"] },
    ],
  },
  {
    id: "weekend",
    name: "Weekend intensive",
    desc: "Two focused days for one difficult topic.",
    hours: 4,
    weeks: [
      { title: "Saturday", tasks: ["Morning: read notes and worked examples", "Afternoon: Socratic practice in Ask", "Evening: make flashcards"] },
      { title: "Sunday", tasks: ["Morning: flashcard review", "Afternoon: timed mock test", "Review mistakes and write a summary"] },
    ],
  },
];

// Quiz questions. `verified` = the correct option was confirmed with SymPy.
export const QUIZ_BANK = [
  {
    type: "mcq",
    q: "What are the roots of $x^2 - 5x + 6 = 0$?",
    options: ["$x = 1, 6$", "$x = 2, 3$", "$x = -2, -3$", "$x = -1, 6$"],
    answer: 1,
    explanation: "It factorises as $(x - 2)(x - 3) = 0$, so $x = 2$ or $x = 3$.",
    verified: true,
  },
  {
    type: "mcq",
    q: "What is $\\frac{d}{dx}\\, e^{2x}$?",
    options: ["$e^{2x}$", "$2e^{x}$", "$2e^{2x}$", "$\\frac{1}{2}e^{2x}$"],
    answer: 2,
    explanation: "By the chain rule, the derivative of $e^{u}$ is $e^{u} \\cdot u'$, and $u' = 2$.",
    verified: true,
  },
  {
    type: "short",
    q: "What is the determinant of $\\begin{pmatrix}3 & 1\\\\ 4 & 2\\end{pmatrix}$?",
    accept: ["2"],
    display: "$2$",
    explanation: "$ad - bc = 3 \\cdot 2 - 1 \\cdot 4 = 2$.",
    verified: true,
  },
  {
    type: "mcq",
    q: "Which statement about eigenvalues is true?",
    options: [
      "Every matrix has only real eigenvalues",
      "The eigenvalues of a triangular matrix are its diagonal entries",
      "A matrix with eigenvalue $0$ is always invertible",
      "Eigenvalues do not depend on the matrix",
    ],
    answer: 1,
    explanation: "For a triangular matrix, $\\det(A - \\lambda I)$ is the product of $(a_{ii} - \\lambda)$, so the roots are the diagonal entries.",
    verified: false,
  },
  {
    type: "short",
    q: "Evaluate $\\int_0^2 3x^2 \\, dx$.",
    accept: ["8"],
    display: "$8$",
    explanation: "An antiderivative is $x^3$, so the integral is $2^3 - 0^3 = 8$.",
    verified: true,
  },
  {
    type: "mcq",
    q: "What is the rank of $\\begin{pmatrix}1 & 2\\\\ 2 & 4\\end{pmatrix}$?",
    options: ["$0$", "$1$", "$2$", "$4$"],
    answer: 1,
    explanation: "The second row is twice the first, so only one row is linearly independent.",
    verified: true,
  },
];

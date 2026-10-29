"""Draws a graph for a maths question, using SymPy (to understand the maths)
and matplotlib (to draw it). No AI is used here, so the graph is always exact.

The one function the rest of the app uses is make_plot(question).
It returns a dictionary with the picture (as base64 PNG text), or None
if the question has nothing we can draw (for example "what is a matrix?").
"""
import base64
import io
import re

import matplotlib
matplotlib.use("Agg")  # draw into memory, not a window (needed on a server)
import matplotlib.pyplot as plt
import numpy as np
import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr,
    standard_transformations,
)

x = sp.Symbol("x")

# Only these words may appear in a formula. Anything else is rejected,
# so a student can never make the server run unexpected code.
ALLOWED_WORDS = {
    "x", "y", "e", "pi", "sin", "cos", "tan", "sec", "csc", "cot",
    "asin", "acos", "atan", "sinh", "cosh", "tanh",
    "exp", "log", "ln", "sqrt", "abs",
}
SAFE_NAMES = {
    "x": x, "e": sp.E, "pi": sp.pi, "ln": sp.log, "abs": sp.Abs,
    "sin": sp.sin, "cos": sp.cos, "tan": sp.tan, "sec": sp.sec, "csc": sp.csc, "cot": sp.cot,
    "asin": sp.asin, "acos": sp.acos, "atan": sp.atan,
    "sinh": sp.sinh, "cosh": sp.cosh, "tanh": sp.tanh,
    "exp": sp.exp, "log": sp.log, "sqrt": sp.sqrt,
}
TRANSFORMS = standard_transformations + (implicit_multiplication_application, convert_xor)

def _clean(question):
    """Turn 'Solve x^2 - 5x + 6 = 0' into 'x^2 - 5x + 6 = 0'."""
    text = question.strip().rstrip(".?!")
    text = text.replace("−", "-").replace("×", "*").replace("÷", "/").replace("²", "^2").replace("³", "^3")
    text = re.sub(r"\$", "", text)                      # drop LaTeX dollar signs
    text = re.sub(r"\bwith respect to x\b|\bw\.?r\.?t\.? x\b", "", text, flags=re.I)
    text = re.sub(r"\s*d\s*x\s*$", "", text)             # "integrate x^2 dx" -> "x^2"
    text = re.sub(r"\b(y|f\s*\(\s*x\s*\))\s*=\s*", "", text, flags=re.I)  # "Plot y = ..." -> "Plot ..."
    # Remove command words in front ("Solve", "Find the roots of"), keeping the formula
    m = re.search(r"[-0-9(]|\b(x|sin|cos|tan|sec|csc|cot|asin|acos|atan|sinh|cosh|tanh|exp|log|ln|sqrt|abs|e|pi)\b", text, re.I)
    words_before = text[: m.start()] if m else text
    if m and re.fullmatch(r"[A-Za-z\s,:']*", words_before):
        text = text[m.start():]
    return text.strip()


# Powers must stay small. Something like 9^9^9 has hundreds of millions of digits:
# working it out would freeze the whole server, so we refuse it before SymPy tries.
MAX_POWER = 100


def _small_powers(expr):
    """True if every power in a not-yet-worked-out formula has a small exponent."""
    for node in sp.postorder_traversal(expr):  # inner parts first, so they are already checked
        if isinstance(node, sp.Pow) and not node.exp.free_symbols:
            try:
                if abs(complex(sp.N(node.exp))) > MAX_POWER:
                    return False
            except (TypeError, ValueError):
                return False
    return True


def _parse(text, allow_number=False):
    """Parse a formula safely. Returns a SymPy expression, or None."""
    if not text or len(text) > 120:
        return None
    if not re.fullmatch(r"[0-9a-zA-Z+\-*/^().,\s]+", text):
        return None
    if re.search(r"\d{16,}", text):  # no giant numbers
        return None
    for word in re.findall(r"[A-Za-z]+", text):
        if word.lower() not in ALLOWED_WORDS:
            return None
    try:
        # First read it without working anything out, to check the powers are small
        raw = parse_expr(text.lower(), local_dict=dict(SAFE_NAMES), transformations=TRANSFORMS, evaluate=False)
        if not _small_powers(raw):
            return None
        expr = parse_expr(text.lower(), local_dict=dict(SAFE_NAMES), transformations=TRANSFORMS)
    except Exception:
        return None
    if not isinstance(expr, sp.Expr):
        return None
    if allow_number and expr.is_number:
        return expr
    if expr.free_symbols != {x}:
        return None  # we only draw graphs of one variable, x
    return expr


def _understand(question):
    """Work out what to draw. Returns (kind, f, extra) or None."""
    q = question.lower()
    text = _clean(question)

    if text.count("=") == 1:  # an equation like x^2 - 5x + 6 = 0
        left, right = text.split("=")
        lhs = _parse(left.strip(), allow_number=True)
        rhs = _parse(right.strip(), allow_number=True)
        if lhs is None or rhs is None or (lhs - rhs).free_symbols != {x}:
            return None
        return "equation", sp.expand(lhs - rhs), None

    f = _parse(text)
    if f is None:
        return None
    if "differentiat" in q or "derivative" in q:
        return "derivative", f, sp.diff(f, x)
    if "integrat" in q or "integral" in q:
        try:
            return "integral", f, sp.integrate(f, x)
        except Exception:
            return "function", f, None
    return "function", f, None


def _real_roots(f):
    """Real x values where f(x) = 0 (empty list if SymPy cannot find them)."""
    try:
        roots = sp.solveset(f, x, domain=sp.S.Reals)
        if isinstance(roots, sp.FiniteSet) and len(roots) <= 10:
            return sorted(float(r) for r in roots if r.is_real)
    except Exception:
        pass
    return []


def _x_range(points):
    """Choose a window that shows all the interesting points."""
    if not points:
        return -6.0, 6.0
    lo, hi = min(points), max(points)
    pad = max(2.0, (hi - lo) * 0.5)
    return lo - pad, hi + pad


def _y_values(f, xs):
    """Work out y for every x. Gaps (NaN) where the function is not a real number."""
    func = sp.lambdify(x, f, modules=["numpy"])
    with np.errstate(all="ignore"):
        ys = np.asarray(func(xs), dtype=complex) * np.ones_like(xs)
    ys = np.where(np.abs(ys.imag) < 1e-9, ys.real, np.nan).astype(float)
    ys[~np.isfinite(ys)] = np.nan
    return ys


def _y_limits(curves):
    """Ignore huge spikes so the interesting part of the curves stays visible."""
    finite = np.concatenate([ys[np.isfinite(ys)] for ys in curves])
    if finite.size == 0:
        return None
    lo, hi = np.percentile(finite, [3, 97])
    lo, hi = min(lo, 0), max(hi, 0)  # always show the x-axis
    pad = (hi - lo) * 0.15 or 1
    return lo - pad, hi + pad


def _break_jumps(ys, limits):
    """Stop the line jumping across vertical asymptotes (like tan x or 1/x)."""
    ys = ys.copy()
    jumps = np.abs(np.diff(ys)) > (limits[1] - limits[0])
    ys[1:][jumps] = np.nan
    return ys


def make_plot(question):
    """Main entry point. Returns {"image": base64_png, "caption": str, ...} or None."""
    understood = _understand(question)
    if understood is None:
        return None
    kind, f, extra = understood

    roots = _real_roots(f)
    x_min, x_max = _x_range(roots)
    xs = np.linspace(x_min, x_max, 1000)
    ys = _y_values(f, xs)
    if not np.isfinite(ys).any():
        return None

    # Each curve: (y values, colour, line style, legend label)
    curves = [(ys, "#4f46e5", "-", f"$y = {sp.latex(f)}$")]
    if kind == "derivative":
        curves.append((_y_values(extra, xs), "#d97706", "--", f"$y' = {sp.latex(extra)}$"))
        caption = "The curve (solid) and its derivative (dashed). Where the dashed line crosses 0, the curve is flat."
    elif kind == "integral" and extra is not None and not extra.has(sp.Integral):
        curves.append((_y_values(extra, xs), "#d97706", "--", f"$\\int f\\,dx = {sp.latex(extra)}$"))
        caption = "The curve, the area under it (shaded), and one antiderivative (dashed, with C = 0)."
    elif kind == "integral":
        caption = "The curve and the area under it (shaded)."
    elif kind == "equation":
        caption = ("The left side minus the right side, drawn as a curve. "
                   "The answers are where the curve crosses the x-axis (red dots).")
    else:
        caption = "Graph of the function. Red dots show where it crosses the x-axis."

    limits = _y_limits([c[0] for c in curves])
    if limits is None:
        return None

    fig, ax = plt.subplots(figsize=(7, 4.2), dpi=110)
    ax.axhline(0, color="#888", linewidth=0.8)
    ax.axvline(0, color="#888", linewidth=0.8)
    ax.grid(True, alpha=0.25)

    for values, colour, style, label in curves:
        ax.plot(xs, _break_jumps(values, limits), color=colour, linestyle=style, linewidth=2.2, label=label)
    if kind == "integral":
        ax.fill_between(xs, np.clip(ys, *limits), 0, where=np.isfinite(ys), color="#4f46e5", alpha=0.12)

    if roots:
        ax.scatter(roots, [0] * len(roots), color="#dc2626", zorder=5, s=45, label="roots")
        for r in roots:
            ax.annotate(f"x = {r:.4g}", (r, 0), textcoords="offset points", xytext=(0, 10),
                        ha="center", fontsize=9, color="#dc2626")

    ax.set_ylim(*limits)
    ax.set_xlim(x_min, x_max)
    ax.set_xlabel("x")
    ax.set_ylabel("y")
    ax.legend(loc="best", fontsize=9)
    fig.tight_layout()

    buffer = io.BytesIO()
    fig.savefig(buffer, format="png")
    plt.close(fig)

    return {
        "image": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "caption": caption,
        "expression": str(f),
        "roots": roots,
    }

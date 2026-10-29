import concurrent.futures
import json
import os
import time
from pathlib import Path
from typing import Literal

import httpx
from dotenv import load_dotenv

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from google import genai
from google.genai import types

from auth import current_user, init_db, router as auth_router
from plots import make_plot
from security import (LOCAL_ORIGINS, BodySizeLimit, RateLimit, add_security_headers,
                      extra_origins, scrub)
from syllabus import init_syllabus_db, router as syllabus_router

# The host's own API keys, read from backend/.env (never sent to the browser, never logged).
# backend/.env must contain two lines like:
#   GEMINI_API_KEY=...
#   GROQ_API_KEY=...
load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()

# The /docs test page is off unless you turn it on, so strangers can't browse every route.
# To use it while developing, add EDUGUARDIAN_DOCS=1 to backend/.env and restart.
SHOW_DOCS = os.getenv("EDUGUARDIAN_DOCS", "") == "1"
app = FastAPI(
    title="EduGuardian AI",
    debug=False,  # never show error details (code and file paths) to visitors
    docs_url="/docs" if SHOW_DOCS else None,
    redoc_url=None,
    openapi_url="/openapi.json" if SHOW_DOCS else None,
)
app.include_router(auth_router)  # adds /auth/signup, /auth/login, /auth/logout, /auth/me
init_db()  # creates backend/users.db the first time
app.include_router(syllabus_router)  # adds /syllabus (upload, list and delete notes)
init_syllabus_db()

# CORS: which other websites may call this backend from a browser.
# Only pages on this computer, plus any listed in ALLOWED_ORIGINS in backend/.env (see security.py).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=LOCAL_ORIGINS,
    allow_origins=extra_origins(),
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["X-Answered-By"],  # lets the page see which model actually answered
)
app.add_middleware(BodySizeLimit)  # refuses requests over 15 MB

# One instruction per subject (this is where subject-specific behaviour starts)
SUBJECT_PROMPTS = {
    "maths": "You are a maths tutor for college students. Solve step by step, explain each step simply, and state the final answer clearly.",
    "digital_logic": "You are a digital logic tutor for college students. Explain Boolean algebra, truth tables and K-maps step by step in simple language.",
    "quantum": "You are a quantum computing tutor for beginners. Explain concepts simply with small examples and avoid heavy jargon.",
}

# How every answer should be written, so the website can show maths properly
FORMAT_RULES = (
    "Formatting: write your answer in Markdown. Write ALL maths in LaTeX: "
    "inline maths inside single dollar signs like $x^2 + 3x$, and bigger equations "
    "on their own line inside double dollar signs like $$\\frac{a}{b} = c$$. "
    "Do not use \\( \\) or \\[ \\], do not put maths in code blocks, "
    "and do not write maths as plain text like x^2 or sqrt(x). "
    # Tables and diagrams: the website draws these, so never use text art
    "Write every table (truth tables, comparisons, K-map values) as a Markdown table "
    "with a header row and | between columns, for example:\n"
    "| A | B | Y |\n|---|---|---|\n| 0 | 0 | 0 |\n"
    "NEVER draw diagrams with text characters (no ASCII art made of - | + / \\ lines). Instead:\n"
    "- For a logic circuit, write a code block with the language 'logic' and one Boolean equation per line, "
    "using AND, OR, NOT, NAND, NOR, XOR, XNOR and brackets, for example:\n"
    "```logic\nY = (NOT S AND D0) OR (S AND D1)\n```\n"
    "A multiplexer can also be shown as a block: Y = MUX(S, D0, D1) (select line first). "
    "Put each output (like Sum and Carry) on its own line.\n"
    "- For other diagrams (flowcharts, block diagrams, state machines, processes), "
    "write a code block with the language 'mermaid' using simple Mermaid flowchart syntax "
    "(for example: flowchart LR, then lines like A[Input] --> B[Step]). Keep labels short and plain: "
    "no brackets, | or maths symbols inside a label.\n"
    "- Whenever you explain or mention the Bloch sphere (or a qubit state on it), ALWAYS include this "
    "drawing, and do NOT use Mermaid for it. Write a code block with the "
    "language 'figure' holding one line: bloch theta=<degrees> phi=<degrees> label=<state>, for example:\n"
    "```figure\nbloch theta=90 phi=0 label=|+⟩\n```\n"
    "The website draws a real 3-D Bloch sphere from it. Named states also work: bloch state=0, 1, +, -, +i or -i."
)

# Socratic mode: guide the student with questions instead of giving the answer away
SOCRATIC_RULES = (
    "You are in Socratic mode, and these rules win over anything above. Do NOT give the final answer or a full worked solution. "
    "Ask one or two short guiding questions, point out the next small step, "
    "and let the student do the work. If the student shows their own attempt, "
    "tell them which parts are right and where to look again."
)

# The hint ladder: level 1 is the smallest nudge, level 3 the most help.
# No level ever reveals the final answer.
HINT_RULES = {
    1: "Give ONE short nudge (one or two sentences) that points the student in the right direction.",
    2: "Name the method or rule the student should use and say why it fits. Do not apply it.",
    3: "Show only the FIRST step of the working, then stop and ask the student to continue.",
}

# How many earlier messages we send along, so follow-up questions make sense
MAX_HISTORY = 6

# Speed setting: newer Gemini models "think" silently before writing.
# "low" makes them think less, so the answer starts sooner.
FAST_CONFIG = types.GenerateContentConfig(
    thinking_config=types.ThinkingConfig(thinking_level="low"),
)


# Size limits, so nobody can send a whole book and spend the host's AI credit
MAX_QUESTION = 4000   # characters
MAX_TURN = 8000       # one earlier message (answers can be long)


class Turn(BaseModel):
    role: Literal["user", "assistant", "ai"]
    content: str

    @field_validator("content")
    @classmethod
    def shorten(cls, text):
        # Long earlier answers are cut, not refused, so the chat keeps working
        return text if len(text) <= MAX_TURN else text[:MAX_TURN] + " …"


# Model names. The page doesn't choose them: the host does, here or in backend/.env
# (GEMINI_MODEL=... and GROQ_MODEL=...). Otherwise anyone could pick the most
# expensive model and spend the host's money.
DEFAULT_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "").strip() or "gemini-3.8-flash"
DEFAULT_GROQ_MODEL = os.getenv("GROQ_MODEL", "").strip() or "openai/gpt-oss-120b"
ALLOWED_GEMINI_MODELS = {DEFAULT_GEMINI_MODEL}
ALLOWED_GROQ_MODELS = {DEFAULT_GROQ_MODEL, "llama-3.3-70b-versatile"}


class AskRequest(BaseModel):
    subject: str = Field(max_length=40)
    question: str = Field(min_length=1, max_length=MAX_QUESTION)
    model: str = DEFAULT_GEMINI_MODEL          # Gemini model
    backup_model: str = DEFAULT_GROQ_MODEL     # Groq model
    primary: Literal["gemini", "groq"] = "gemini"  # which one answers first (the other is the backup)
    mode: str = "normal"          # "normal" or "socratic"
    history: list[Turn] = Field(default=[], max_length=20)  # the last few messages of this chat (optional)


class HintRequest(BaseModel):
    subject: str = Field(max_length=40)
    question: str = Field(min_length=1, max_length=MAX_QUESTION)
    level: int = 1                # 1, 2 or 3
    model: str = DEFAULT_GEMINI_MODEL
    backup_model: str = DEFAULT_GROQ_MODEL
    primary: Literal["gemini", "groq"] = "gemini"


def check_models(req):
    """Only the host's chosen models may be used."""
    if req.model not in ALLOWED_GEMINI_MODELS or req.backup_model not in ALLOWED_GROQ_MODELS:
        raise HTTPException(status_code=400, detail="That model isn't available on this server.")


# How many AI answers one student can ask for (each one costs the host's free credit)
ASK_PER_MINUTE = RateLimit(15, 60, "You're asking very fast. Please wait a minute and try again.")
ASK_PER_DAY = RateLimit(300, 24 * 3600, "You've reached today's limit of answers. Please come back tomorrow.")
PLOTS_PER_MINUTE = RateLimit(30, 60, "Too many graphs at once. Please wait a minute and try again.")


def count_ai_call(user):
    ASK_PER_MINUTE.hit(user["id"])
    ASK_PER_DAY.hit(user["id"])


def build_prompt(subject, question, mode="normal", history=(), extra=""):
    """Puts together everything the model needs: the subject's instruction,
    Socratic rules (if on), the last few messages, then the new question."""
    parts = [SUBJECT_PROMPTS[subject], FORMAT_RULES]
    if mode == "socratic":
        parts.append(SOCRATIC_RULES)
    if extra:
        parts.append(extra)
    recent = list(history)[-MAX_HISTORY:]
    if recent:
        lines = [f"{'Student' if t.role == 'user' else 'Tutor'}: {t.content}" for t in recent]
        parts.append("Conversation so far:\n" + "\n".join(lines))
    parts.append(f"Question: {question}")
    return "\n\n".join(parts)


class PlotRequest(BaseModel):
    question: str = Field(max_length=MAX_QUESTION)


@app.get("/health")
def health():
    # Only says *whether* each key is set, never the key itself
    return {
        "status": "EduGuardian backend is running",
        "gemini_ready": bool(GEMINI_API_KEY),
        "backup_ready": bool(GROQ_API_KEY),
    }


@app.post("/ask")
def ask(req: AskRequest, user=Depends(current_user)):
    if req.mode not in ("normal", "socratic"):
        raise HTTPException(status_code=400, detail="Unknown mode")
    if req.subject not in SUBJECT_PROMPTS:
        raise HTTPException(status_code=400, detail="Unknown subject")
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="The server has no GEMINI_API_KEY in backend/.env yet.")
    check_models(req)
    count_ai_call(user)

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model=req.model,
            contents=build_prompt(req.subject, req.question, req.mode, req.history),
        )
        return {"subject": req.subject, "model": req.model, "mode": req.mode, "answer": response.text}
    except Exception as e:
        # Never log or return the key itself
        raise HTTPException(status_code=502, detail=f"Model error: {scrub(e)[:300]}")


# ---------- Backup provider (Groq) ----------
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# If the main model has not started writing after this many seconds, switch to the backup
GEMINI_WAIT_SECONDS = 40
# Runs the Gemini call in the background so we can stop waiting for it
EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=8)


def start_gemini(api_key, model, prompt):
    """Start a Gemini answer. Returns (first_text, rest_of_texts)."""
    client = genai.Client(api_key=api_key)
    try:
        stream = client.models.generate_content_stream(model=model, contents=prompt, config=FAST_CONFIG)
        first = next(stream, None)
    except Exception:
        # Some models don't accept the speed setting, so try once more without it
        stream = client.models.generate_content_stream(model=model, contents=prompt)
        first = next(stream, None)
    first_text = first.text if first is not None and first.text else ""
    rest = (chunk.text for chunk in stream if chunk.text)
    return first_text, rest


def start_groq(api_key, model, prompt):
    """Start a Groq answer. Returns (first_text, rest_of_texts)."""
    client = httpx.Client(timeout=60)
    request = client.build_request(
        "POST",
        GROQ_URL,
        headers={"Authorization": f"Bearer {api_key}"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}], "stream": True},
    )
    response = client.send(request, stream=True)
    if response.status_code != 200:
        response.read()
        message = response.text[:300]
        response.close()
        client.close()
        raise RuntimeError(f"Groq error {response.status_code}: {message}")

    def texts():
        # Groq sends lines like: data: {"choices":[{"delta":{"content":"Hello"}}]}
        try:
            for line in response.iter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[len("data: "):]
                if data == "[DONE]":
                    break
                piece = json.loads(data)["choices"][0]["delta"].get("content")
                if piece:
                    yield piece
        finally:
            response.close()
            client.close()

    rest = texts()
    return next(rest, ""), rest


def start_answer(req, prompt):
    """Starts an answer with the main provider and switches to the other one
    if it fails or is too slow. Returns (first_text, rest_of_texts, model_that_answered)."""
    gemini = ("Gemini", GEMINI_API_KEY, req.model, start_gemini)
    groq = ("Groq", GROQ_API_KEY, req.backup_model, start_groq)
    main, backup = (groq, gemini) if req.primary == "groq" else (gemini, groq)

    name, key, model, starter = main
    try:
        if not key:
            raise RuntimeError(f"no {name.upper()}_API_KEY in backend/.env")
        first, rest = EXECUTOR.submit(starter, key, model, prompt).result(timeout=GEMINI_WAIT_SECONDS)
        return first, rest, model
    except Exception as e:
        # Never log or return the keys themselves
        if isinstance(e, concurrent.futures.TimeoutError):
            reason = f"no answer after {GEMINI_WAIT_SECONDS}s"
        else:
            reason = scrub(e)[:300]

    b_name, b_key, b_model, b_starter = backup
    if not b_key:
        raise HTTPException(status_code=502, detail=f"Model error: {reason}")
    print(f"[answer] {model} failed ({reason[:80]}), using backup {b_model}", flush=True)
    try:
        first, rest = b_starter(b_key, b_model, prompt)
    except Exception as e2:
        raise HTTPException(status_code=502, detail=f"Main model: {reason} | Backup model: {scrub(e2)[:300]}")
    return first, rest, b_model


@app.post("/ask/stream")
def ask_stream(req: AskRequest, user=Depends(current_user)):
    """Same as /ask, but sends the answer piece by piece as the model writes it.
    If the main model fails or is too slow and the server has the other key, the backup answers instead."""
    if req.mode not in ("normal", "socratic"):
        raise HTTPException(status_code=400, detail="Unknown mode")
    if req.subject not in SUBJECT_PROMPTS:
        raise HTTPException(status_code=400, detail="Unknown subject")
    if not GEMINI_API_KEY and not GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="The server has no API keys in backend/.env yet.")
    check_models(req)
    count_ai_call(user)

    start = time.time()
    prompt = build_prompt(req.subject, req.question, req.mode, req.history)
    first, rest, answered_by = start_answer(req, prompt)

    first_wait = time.time() - start

    def pieces():
        if first:
            yield first
        try:
            for text in rest:
                yield text
        except Exception:
            yield "\n\n*(The answer was cut off by a model error. Please try again.)*"
        # Timing shows in the uvicorn window, so you can see where the time goes
        print(f"[ask/stream] {req.subject} / {answered_by}: first words after {first_wait:.1f}s, "
              f"full answer after {time.time() - start:.1f}s", flush=True)

    return StreamingResponse(
        pieces(),
        media_type="text/plain; charset=utf-8",
        headers={"X-Answered-By": answered_by},
    )


@app.post("/hint")
def hint(req: HintRequest, user=Depends(current_user)):
    """One rung of the hint ladder for the Ask screen (level 1, 2 or 3).
    Same main model + backup as /ask/stream, but returns the whole hint at once."""
    if req.subject not in SUBJECT_PROMPTS:
        raise HTTPException(status_code=400, detail="Unknown subject")
    if req.level not in HINT_RULES:
        raise HTTPException(status_code=400, detail="Hint level must be 1, 2 or 3")
    if not GEMINI_API_KEY and not GROQ_API_KEY:
        raise HTTPException(status_code=503, detail="The server has no API keys in backend/.env yet.")
    check_models(req)
    count_ai_call(user)

    prompt = build_prompt(req.subject, req.question, "socratic", extra=HINT_RULES[req.level])
    first, rest, answered_by = start_answer(req, prompt)
    try:
        text = first + "".join(rest)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Model error: {scrub(e)[:300]}")
    return {"level": req.level, "hint": text, "answered_by": answered_by}


@app.post("/plot")
def plot(req: PlotRequest, user=Depends(current_user)):
    """Draws a graph for a maths question with SymPy + matplotlib (no AI, no API key needed).
    Returns {"image": None} when there is nothing to draw, e.g. "What is a matrix?"."""
    PLOTS_PER_MINUTE.hit(user["id"])
    try:
        result = make_plot(req.question)
    except Exception as e:
        print(f"[plot] could not draw a graph: {e}", flush=True)
        result = None
    return result or {"image": None}


# ---------- The website ----------
# The backend also serves the pages in public/, so one server runs everything:
# open http://127.0.0.1:8000 and you get the site. This must stay at the very end,
# so the routes above (/auth, /ask, /hint, /plot, /syllabus, /health) are matched first.
@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Adds the security headers from security.py to every reply, and tells the
    browser to check for a newer version of each page, style and script."""
    response = await call_next(request)
    add_security_headers(request, response)
    return response


PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
if PUBLIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="website")

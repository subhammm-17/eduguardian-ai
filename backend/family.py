"""Parental controls for EduGuardian AI.

A parent account can link to a student account, see the student's progress,
and choose how the AI answers that student:
- "hints":  hints and partial steps that teach the idea. The AI never gives the
            final answer, so the child has to finish the last step.
- "direct": normal full answers.

How linking works (the student must agree, so no stranger can watch a child):
1. The student opens "Parent link" in their account menu and creates a code.
   The code works once, for 30 minutes.
2. The parent signs in to their own account and types that code.

The answer mode is checked on the server for every question (see main.py),
so a child can't switch it off from the browser or by asking the AI.

What is stored (all in backend/users.db):
- link_codes:    codes waiting to be used (only a hash of each code)
- parent_links:  which parent is linked to which student, and the answer mode
- activity:      each question and hint a student asked (subject, mode, short text)
- progress:      the student's roadmap progress, sent by their browser
"""
import hashlib
import re
import secrets
import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from auth import _db, current_user
from security import RateLimit, client_ip

router = APIRouter(prefix="/family", tags=["family"])

CODE_MINUTES = 30
CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O or 1/I, which are easy to mix up
CODE_LENGTH = 8
MAX_CHILDREN = 10      # per parent
MAX_PARENTS = 4        # per student
DEFAULT_MODE = "hints" # when a parent first links, the child gets hint mode
KEEP_ACTIVITY = 1000   # newest entries kept per student, so the database stays small
SUBJECTS = {"maths": "Mathematics", "digital_logic": "Digital logic", "quantum": "Quantum computing"}

# Rate limits: codes are 8 letters, and these stop anyone from guessing them
LINK_PER_PARENT = RateLimit(10, 15 * 60, "Too many wrong codes. Please wait 15 minutes and try again.")
LINK_PER_IP = RateLimit(20, 15 * 60, "Too many wrong codes. Please wait 15 minutes and try again.")
CODES_PER_STUDENT = RateLimit(10, 60 * 60, "Too many codes. Please try again in an hour.")
PROGRESS_PER_USER = RateLimit(60, 60, "Too many updates. Please wait a minute.")
CHANGES_PER_PARENT = RateLimit(30, 60, "Too many changes. Please wait a minute.")


def init_family_db():
    """Create the tables the first time the server starts."""
    with _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS link_codes (
                code_hash TEXT PRIMARY KEY,
                student_id INTEGER NOT NULL REFERENCES users(id),
                expires_at INTEGER NOT NULL
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS parent_links (
                parent_id INTEGER NOT NULL REFERENCES users(id),
                student_id INTEGER NOT NULL REFERENCES users(id),
                answer_mode TEXT NOT NULL DEFAULT 'hints',
                created_at INTEGER NOT NULL,
                PRIMARY KEY (parent_id, student_id)
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                kind TEXT NOT NULL,
                subject TEXT NOT NULL,
                mode TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS activity_user ON activity (user_id, created_at)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS progress (
                user_id INTEGER PRIMARY KEY REFERENCES users(id),
                percent INTEGER NOT NULL,
                done INTEGER NOT NULL,
                total INTEGER NOT NULL,
                subject TEXT NOT NULL,
                exam_date TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            )""")


# ---------- Used by main.py on every question ----------
def answer_mode_for(user):
    """The answer mode parents chose for this student: "hints", "direct", or None (no parent).
    If two parents disagree, the stricter one ("hints") wins."""
    if user.get("role") != "student":
        return None
    with _db() as conn:
        modes = {r["answer_mode"] for r in conn.execute(
            "SELECT answer_mode FROM parent_links WHERE student_id = ?", (user["id"],))}
    if not modes:
        return None
    return "hints" if "hints" in modes else "direct"


def log_activity(user, kind, subject, mode, text):
    """Remember one question or hint, so linked parents can see it.
    Only students are logged, and only the first 300 characters of the question."""
    if user.get("role") != "student":
        return
    text = re.sub(r"\s+", " ", text).strip()[:300]
    with _db() as conn:
        conn.execute(
            "INSERT INTO activity (user_id, kind, subject, mode, text, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (user["id"], kind, subject, mode, text, int(time.time())))
        # Forget the oldest entries once a student has more than KEEP_ACTIVITY
        conn.execute("""DELETE FROM activity WHERE user_id = ? AND id NOT IN
                        (SELECT id FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT ?)""",
                     (user["id"], user["id"], KEEP_ACTIVITY))


# ---------- Who may use which route ----------
def student_user(user=Depends(current_user)):
    if user["role"] != "student":
        raise HTTPException(status_code=403, detail="Only student accounts can do this.")
    return user


def parent_user(user=Depends(current_user)):
    if user["role"] != "parent":
        raise HTTPException(status_code=403, detail="Only parent accounts can do this.")
    return user


def _code_hash(code):
    return hashlib.sha256(code.encode()).hexdigest()


def _clean_code(code):
    """Accepts 'abcd-efgh', 'ABCD EFGH' or 'ABCDEFGH' and returns 'ABCDEFGH'."""
    return re.sub(r"[^A-Z0-9]", "", code.upper())


def _linked_child(conn, parent_id, student_id):
    """The link row, or a 404. This check is what stops a parent from seeing
    any child who did not give them a code."""
    row = conn.execute(
        """SELECT users.id, users.name, users.email, parent_links.answer_mode, parent_links.created_at
           FROM parent_links JOIN users ON users.id = parent_links.student_id
           WHERE parent_links.parent_id = ? AND parent_links.student_id = ?""",
        (parent_id, student_id)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Child not found.")
    return row


def _summary(conn, child):
    """The short version of a child's progress, for the list of children."""
    week_ago = int(time.time()) - 7 * 24 * 3600
    questions = conn.execute(
        "SELECT COUNT(*) FROM activity WHERE user_id = ? AND kind = 'question' AND created_at > ?",
        (child["id"], week_ago)).fetchone()[0]
    last = conn.execute("SELECT MAX(created_at) FROM activity WHERE user_id = ?", (child["id"],)).fetchone()[0]
    road = conn.execute("SELECT percent FROM progress WHERE user_id = ?", (child["id"],)).fetchone()
    return {
        "id": child["id"], "name": child["name"], "email": child["email"],
        "answer_mode": child["answer_mode"],
        "questions_week": questions,
        "roadmap_percent": road["percent"] if road else None,
        "last_active": last,
    }


# ---------- Student routes ----------
@router.get("/me")
def my_family(user=Depends(current_user)):
    """For the student's workspace: is hint mode on, and which parents are linked."""
    if user["role"] != "student":
        return {"role": user["role"], "answer_mode": None, "parents": []}
    with _db() as conn:
        parents = conn.execute(
            """SELECT users.name FROM parent_links JOIN users ON users.id = parent_links.parent_id
               WHERE parent_links.student_id = ? ORDER BY parent_links.created_at""",
            (user["id"],)).fetchall()
    return {"role": "student", "answer_mode": answer_mode_for(user), "parents": [p["name"] for p in parents]}


@router.post("/code")
def make_code(user=Depends(student_user)):
    """Creates a one-time code the student gives to their parent."""
    CODES_PER_STUDENT.hit(user["id"])
    code = "".join(secrets.choice(CODE_LETTERS) for _ in range(CODE_LENGTH))
    expires = int(time.time()) + CODE_MINUTES * 60
    with _db() as conn:
        # Only the newest code works, and old codes are tidied up
        conn.execute("DELETE FROM link_codes WHERE student_id = ? OR expires_at < ?", (user["id"], int(time.time())))
        conn.execute("INSERT INTO link_codes (code_hash, student_id, expires_at) VALUES (?, ?, ?)",
                     (_code_hash(code), user["id"], expires))
    return {"code": f"{code[:4]}-{code[4:]}", "expires_at": expires, "minutes": CODE_MINUTES}


class ProgressRequest(BaseModel):
    percent: int = Field(ge=0, le=100)
    done: int = Field(ge=0, le=10_000)
    total: int = Field(ge=0, le=10_000)
    subject: str = Field(default="", max_length=80)
    exam_date: str = Field(default="", max_length=10)


@router.post("/progress")
def save_progress(req: ProgressRequest, user=Depends(student_user)):
    """The student's browser sends its roadmap progress here, so parents can see it."""
    PROGRESS_PER_USER.hit(user["id"])
    exam = req.exam_date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", req.exam_date) else ""
    subject = re.sub(r"[\x00-\x1f\x7f]", "", req.subject).strip()
    with _db() as conn:
        conn.execute(
            """INSERT INTO progress (user_id, percent, done, total, subject, exam_date, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (user_id) DO UPDATE SET percent = excluded.percent, done = excluded.done,
                 total = excluded.total, subject = excluded.subject, exam_date = excluded.exam_date,
                 updated_at = excluded.updated_at""",
            (user["id"], req.percent, min(req.done, req.total), req.total, subject, exam, int(time.time())))
    return {"ok": True}


# ---------- Parent routes ----------
class LinkRequest(BaseModel):
    code: str = Field(max_length=20)


@router.post("/link")
def link_child(req: LinkRequest, request: Request, user=Depends(parent_user)):
    LINK_PER_PARENT.hit(user["id"])
    LINK_PER_IP.hit(client_ip(request))
    code = _clean_code(req.code)
    with _db() as conn:
        row = conn.execute("SELECT student_id FROM link_codes WHERE code_hash = ? AND expires_at > ?",
                           (_code_hash(code), int(time.time()))).fetchone()
        if row is None:
            raise HTTPException(status_code=400, detail="That code is wrong or has expired. Ask your child for a new one.")
        student_id = row["student_id"]
        conn.execute("DELETE FROM link_codes WHERE code_hash = ?", (_code_hash(code),))  # each code works once
        if conn.execute("SELECT 1 FROM parent_links WHERE parent_id = ? AND student_id = ?",
                        (user["id"], student_id)).fetchone() is None:
            children = conn.execute("SELECT COUNT(*) FROM parent_links WHERE parent_id = ?", (user["id"],)).fetchone()[0]
            parents = conn.execute("SELECT COUNT(*) FROM parent_links WHERE student_id = ?", (student_id,)).fetchone()[0]
            if children >= MAX_CHILDREN:
                raise HTTPException(status_code=400, detail=f"You can link up to {MAX_CHILDREN} children.")
            if parents >= MAX_PARENTS:
                raise HTTPException(status_code=400, detail=f"This student already has {MAX_PARENTS} parents linked.")
            conn.execute("INSERT INTO parent_links (parent_id, student_id, answer_mode, created_at) VALUES (?, ?, ?, ?)",
                         (user["id"], student_id, DEFAULT_MODE, int(time.time())))
        return _summary(conn, _linked_child(conn, user["id"], student_id))


@router.get("/children")
def list_children(user=Depends(parent_user)):
    with _db() as conn:
        rows = conn.execute(
            """SELECT users.id, users.name, users.email, parent_links.answer_mode, parent_links.created_at
               FROM parent_links JOIN users ON users.id = parent_links.student_id
               WHERE parent_links.parent_id = ? ORDER BY parent_links.created_at""",
            (user["id"],)).fetchall()
        return {"children": [_summary(conn, r) for r in rows]}


@router.get("/children/{student_id}")
def child_details(student_id: int, user=Depends(parent_user)):
    """Everything the parent dashboard shows for one child."""
    now = int(time.time())
    week_ago = now - 7 * 24 * 3600
    with _db() as conn:
        child = _linked_child(conn, user["id"], student_id)
        summary = _summary(conn, child)
        week = conn.execute(
            "SELECT kind, subject, created_at FROM activity WHERE user_id = ? AND created_at > ?",
            (student_id, week_ago)).fetchall()
        total = conn.execute("SELECT COUNT(*) FROM activity WHERE user_id = ? AND kind = 'question'",
                             (student_id,)).fetchone()[0]
        recent = conn.execute(
            "SELECT kind, subject, mode, text, created_at FROM activity WHERE user_id = ? ORDER BY id DESC LIMIT 20",
            (student_id,)).fetchall()
        road = conn.execute("SELECT * FROM progress WHERE user_id = ?", (student_id,)).fetchone()

    by_subject = {name: 0 for name in SUBJECTS.values()}
    for r in week:
        if r["kind"] == "question":
            name = SUBJECTS.get(r["subject"], r["subject"])
            by_subject[name] = by_subject.get(name, 0) + 1
    return {
        **summary,
        "questions_total": total,
        "hints_week": sum(1 for r in week if r["kind"] == "hint"),
        # Times are sent as Unix seconds; the browser groups them into its own days
        "week_times": [r["created_at"] for r in week if r["kind"] == "question"],
        "by_subject": by_subject,
        "recent": [{"kind": r["kind"], "subject": SUBJECTS.get(r["subject"], r["subject"]),
                    "mode": r["mode"], "text": r["text"], "at": r["created_at"]} for r in recent],
        "roadmap": None if road is None else {
            "percent": road["percent"], "done": road["done"], "total": road["total"],
            "subject": road["subject"], "exam_date": road["exam_date"], "updated_at": road["updated_at"]},
    }


class ModeRequest(BaseModel):
    answer_mode: Literal["hints", "direct"]


@router.post("/children/{student_id}/mode")
def set_mode(student_id: int, req: ModeRequest, user=Depends(parent_user)):
    CHANGES_PER_PARENT.hit(user["id"])
    with _db() as conn:
        _linked_child(conn, user["id"], student_id)
        conn.execute("UPDATE parent_links SET answer_mode = ? WHERE parent_id = ? AND student_id = ?",
                     (req.answer_mode, user["id"], student_id))
    return {"answer_mode": req.answer_mode}


@router.delete("/children/{student_id}")
def unlink_child(student_id: int, user=Depends(parent_user)):
    with _db() as conn:
        _linked_child(conn, user["id"], student_id)
        conn.execute("DELETE FROM parent_links WHERE parent_id = ? AND student_id = ?", (user["id"], student_id))
    return {"ok": True}

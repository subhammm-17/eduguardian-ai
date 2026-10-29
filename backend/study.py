"""A student's own study data for EduGuardian AI: today's plan, the roadmap,
quiz scores and flashcard reviews.

Older versions kept today's plan and the roadmap in the browser (localStorage)
and filled the Home page with sample numbers. Now everything is saved in the
database for each account, so:
- a new student starts with an empty Home page (no made-up numbers),
- your plan follows you to another computer, and two people sharing a computer
  don't see each other's plan,
- a linked parent sees real progress (see family.py).
"""
import json
import re
import time
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import _db, current_user
from chats import recent_chats
from security import RateLimit

KEEP_QUIZZES = 100       # newest quiz scores kept per student
SAVES_PER_USER = RateLimit(120, 60, "Too many changes at once. Please wait a minute.")

router = APIRouter(prefix="/study", tags=["study"])


def init_study_db():
    """Create the tables the first time the server starts."""
    with _db() as conn:
        # One row per student and kind ("tasks" or "roadmap"), holding JSON text
        conn.execute("""
            CREATE TABLE IF NOT EXISTS study_data (
                user_id INTEGER NOT NULL REFERENCES users(id),
                kind TEXT NOT NULL,
                data TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, kind)
            )""")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS quiz_results (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                topic TEXT NOT NULL,
                score INTEGER NOT NULL,
                total INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS quiz_results_user ON quiz_results (user_id, id)")
        # Flashcards reviewed per day. day is the student's own date, like 2026-10-29
        conn.execute("""
            CREATE TABLE IF NOT EXISTS card_reviews (
                user_id INTEGER NOT NULL REFERENCES users(id),
                day TEXT NOT NULL,
                count INTEGER NOT NULL,
                PRIMARY KEY (user_id, day)
            )""")


def _clean(text):
    """Plain one-line text: no control characters like new lines."""
    return re.sub(r"[\x00-\x1f\x7f]", "", text).strip()


# ---------- What the browser may save ----------
# Every field has a size limit, so nobody can fill the database.
class Task(BaseModel):
    id: str = Field(max_length=40)
    title: str = Field(max_length=200)
    minutes: int = Field(ge=1, le=600)
    done: bool = False


class TasksRequest(BaseModel):
    tasks: list[Task] = Field(max_length=100)


class RoadmapTask(BaseModel):
    id: str = Field(max_length=40)
    text: str = Field(max_length=200)
    done: bool = False


class RoadmapSection(BaseModel):
    title: str = Field(max_length=100)
    dates: str = Field(default="", max_length=40)
    tasks: list[RoadmapTask] = Field(max_length=100)


class Roadmap(BaseModel):
    tpl: str = Field(max_length=40)
    subject: str = Field(max_length=80)
    examDate: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    hours: float = Field(ge=0, le=24)
    level: str = Field(max_length=20)
    sections: list[RoadmapSection] = Field(max_length=20)


class RoadmapRequest(BaseModel):
    roadmap: Optional[Roadmap] = None   # None deletes the plan


class QuizRequest(BaseModel):
    topic: str = Field(max_length=120)
    score: int = Field(ge=0, le=100)
    total: int = Field(ge=1, le=100)


class CardsRequest(BaseModel):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    count: int = Field(ge=1, le=500)


def _load(conn, user_id, kind):
    row = conn.execute("SELECT data FROM study_data WHERE user_id = ? AND kind = ?", (user_id, kind)).fetchone()
    return None if row is None else json.loads(row["data"])


def _store(conn, user_id, kind, value):
    conn.execute(
        """INSERT INTO study_data (user_id, kind, data, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (user_id, kind) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at""",
        (user_id, kind, json.dumps(value), int(time.time())))


def roadmap_progress(roadmap):
    """(done, total, percent) of a saved roadmap."""
    tasks = [t for s in roadmap["sections"] for t in s["tasks"]]
    done = sum(1 for t in tasks if t["done"])
    return done, len(tasks), round(done * 100 / len(tasks)) if tasks else 0


# ---------- Used by the parent dashboard (family.py) ----------
def study_summary(conn, user_id):
    """Today's plan, quiz scores and flashcard reviews of one student."""
    tasks = _load(conn, user_id, "tasks") or []
    week_ago = int(time.time()) - 7 * 24 * 3600
    quizzes = conn.execute(
        "SELECT topic, score, total, created_at FROM quiz_results WHERE user_id = ? ORDER BY id DESC LIMIT 5",
        (user_id,)).fetchall()
    quizzes_week = conn.execute(
        "SELECT score, total FROM quiz_results WHERE user_id = ? AND created_at > ?", (user_id, week_ago)).fetchall()
    first_day = (date.today() - timedelta(days=7)).isoformat()
    cards_week = conn.execute(
        "SELECT COALESCE(SUM(count), 0) FROM card_reviews WHERE user_id = ? AND day >= ?",
        (user_id, first_day)).fetchone()[0]
    return {
        "tasks_done": sum(1 for t in tasks if t.get("done")),
        "tasks_total": len(tasks),
        "quizzes": [{"topic": q["topic"], "score": q["score"], "total": q["total"], "at": q["created_at"]}
                    for q in quizzes],
        "quizzes_week": len(quizzes_week),
        "quiz_average_week": round(sum(q["score"] * 100 / q["total"] for q in quizzes_week) / len(quizzes_week))
                             if quizzes_week else None,
        "cards_week": int(cards_week),
    }


# ---------- Routes ----------
@router.get("")
def my_study(user=Depends(current_user)):
    """Everything the Home page shows. A new student gets empty lists, not sample data."""
    first_day = (date.today() - timedelta(days=10)).isoformat()
    with _db() as conn:
        tasks = _load(conn, user["id"], "tasks")
        roadmap = _load(conn, user["id"], "roadmap")
        quizzes = conn.execute(
            "SELECT topic, score, total, created_at FROM quiz_results WHERE user_id = ? ORDER BY id DESC LIMIT 8",
            (user["id"],)).fetchall()
        cards = conn.execute("SELECT day, count FROM card_reviews WHERE user_id = ? AND day >= ? ORDER BY day",
                             (user["id"], first_day)).fetchall()
    return {
        # None means "never saved" (the browser may then move an older plan over from localStorage)
        "tasks": tasks,
        "roadmap": roadmap,
        "quizzes": [{"topic": q["topic"], "score": q["score"], "total": q["total"], "at": q["created_at"]}
                    for q in reversed(quizzes)],  # oldest first, for the chart
        "cards": [{"day": c["day"], "count": c["count"]} for c in cards],
        "recent_chats": recent_chats(user["id"], 5),
    }


@router.post("/tasks")
def save_tasks(req: TasksRequest, user=Depends(current_user)):
    SAVES_PER_USER.hit(user["id"])
    tasks = [{**t.model_dump(), "title": _clean(t.title)} for t in req.tasks]
    with _db() as conn:
        _store(conn, user["id"], "tasks", tasks)
    return {"ok": True}


@router.post("/roadmap")
def save_roadmap(req: RoadmapRequest, user=Depends(current_user)):
    """Saves the roadmap, and its progress for linked parents (the progress table in family.py)."""
    SAVES_PER_USER.hit(user["id"])
    with _db() as conn:
        if req.roadmap is None:
            conn.execute("DELETE FROM study_data WHERE user_id = ? AND kind = 'roadmap'", (user["id"],))
            conn.execute("DELETE FROM progress WHERE user_id = ?", (user["id"],))
            return {"ok": True}
        roadmap = req.roadmap.model_dump()
        roadmap["subject"] = _clean(roadmap["subject"])
        _store(conn, user["id"], "roadmap", roadmap)
        done, total, percent = roadmap_progress(roadmap)
        conn.execute(
            """INSERT INTO progress (user_id, percent, done, total, subject, exam_date, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (user_id) DO UPDATE SET percent = excluded.percent, done = excluded.done,
                 total = excluded.total, subject = excluded.subject, exam_date = excluded.exam_date,
                 updated_at = excluded.updated_at""",
            (user["id"], percent, done, total, roadmap["subject"], roadmap["examDate"], int(time.time())))
    return {"ok": True}


@router.post("/quiz")
def save_quiz(req: QuizRequest, user=Depends(current_user)):
    SAVES_PER_USER.hit(user["id"])
    with _db() as conn:
        conn.execute("INSERT INTO quiz_results (user_id, topic, score, total, created_at) VALUES (?, ?, ?, ?, ?)",
                     (user["id"], _clean(req.topic) or "Quiz", min(req.score, req.total), req.total, int(time.time())))
        conn.execute("""DELETE FROM quiz_results WHERE user_id = ? AND id NOT IN
                        (SELECT id FROM quiz_results WHERE user_id = ? ORDER BY id DESC LIMIT ?)""",
                     (user["id"], user["id"], KEEP_QUIZZES))
    return {"ok": True}


@router.post("/cards")
def save_cards(req: CardsRequest, user=Depends(current_user)):
    """Adds `count` flashcard reviews to the student's day."""
    SAVES_PER_USER.hit(user["id"])
    # The browser sends its own date; it may differ from the server's by a day (time zones), not more
    try:
        gap = abs((date.fromisoformat(req.day) - date.today()).days)
    except ValueError:
        gap = 99
    if gap > 1:
        raise HTTPException(status_code=400, detail="Please check your computer's date.")
    with _db() as conn:
        conn.execute(
            """INSERT INTO card_reviews (user_id, day, count) VALUES (?, ?, ?)
               ON CONFLICT (user_id, day) DO UPDATE SET count = card_reviews.count + excluded.count""",
            (user["id"], req.day, req.count))
    return {"ok": True}

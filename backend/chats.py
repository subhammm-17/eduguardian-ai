"""Chat history for EduGuardian AI.

Every conversation on the Ask page is saved in the database, so a student can
come back to it later (the History button on the Ask page).

- A conversation ("chat") belongs to one student and one subject.
  When the student changes the subject, a new chat starts and the old one stays in History.
- A chat can be tied to one uploaded syllabus file. Its answers then come from that file
  (see notes.py).
- To keep the database small, only the newest KEEP_CHATS chats of each student are kept.
  The oldest ones are deleted automatically.

The questions and answers are saved by main.py while it answers (save_message below),
so the browser can't write fake answers into someone's history.
"""
import re
import time

from fastapi import APIRouter, Depends, HTTPException

from auth import _db, current_user
from security import RateLimit

KEEP_CHATS = 30             # newest chats kept per student (the rest are deleted)
MAX_MESSAGES = 200          # per chat; after that the next question starts a new chat
MAX_SAVED_TEXT = 40_000     # characters kept of one message (answers can be long)
TITLE_LENGTH = 80
HISTORY_PER_USER = RateLimit(120, 60, "Too many requests. Please wait a minute.")

router = APIRouter(prefix="/chats", tags=["chats"])


def init_chats_db():
    """Create the tables the first time the server starts."""
    with _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                subject TEXT NOT NULL,
                title TEXT NOT NULL,
                file_id INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS chats_user ON chats (user_id, updated_at)")
        # role is "user" (the question), "ai" (an answer) or "hint" (a hint, with its level)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                mode TEXT NOT NULL DEFAULT '',
                answered_by TEXT NOT NULL DEFAULT '',
                level INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )""")
        conn.execute("CREATE INDEX IF NOT EXISTS chat_messages_chat ON chat_messages (chat_id, id)")


def _title(question):
    text = re.sub(r"\s+", " ", question).strip()
    return text if len(text) <= TITLE_LENGTH else text[:TITLE_LENGTH - 1] + "…"


def _own_chat(conn, user_id, chat_id):
    """The chat row, but only if it belongs to this student (otherwise None)."""
    return conn.execute("SELECT * FROM chats WHERE id = ? AND user_id = ?", (chat_id, user_id)).fetchone()


def _delete_chat(conn, chat_id):
    conn.execute("DELETE FROM chat_messages WHERE chat_id = ?", (chat_id,))
    conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))


# ---------- Used by main.py on every question ----------
def usable_chat(user, chat_id, subject, file_id=None, check_file=True):
    """The chat id if the next question can go into this chat, otherwise None
    (then main.py starts a new chat). A new chat is needed when the chat isn't this
    student's, when the subject or the syllabus file changed, or when the chat is full."""
    if not chat_id:
        return None
    with _db() as conn:
        chat = _own_chat(conn, user["id"], chat_id)
        if chat is None or chat["subject"] != subject or (check_file and chat["file_id"] != file_id):
            return None
        count = conn.execute("SELECT COUNT(*) FROM chat_messages WHERE chat_id = ?", (chat_id,)).fetchone()[0]
    return chat["id"] if count < MAX_MESSAGES else None


def new_chat(user, subject, question, file_id=None):
    """Starts a chat and returns its id. Deletes this student's oldest chats beyond KEEP_CHATS."""
    now = int(time.time())
    with _db() as conn:
        new_id = conn.execute(
            """INSERT INTO chats (user_id, subject, title, file_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?) RETURNING id""",
            (user["id"], subject, _title(question), file_id, now, now)).fetchone()["id"]
        old = conn.execute(
            "SELECT id FROM chats WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
            (user["id"],)).fetchall()[KEEP_CHATS:]
        for row in old:
            _delete_chat(conn, row["id"])
    return new_id


def history_for(chat_id, limit):
    """The last `limit` questions and answers of a chat, oldest first (hints are left out)."""
    with _db() as conn:
        rows = conn.execute(
            """SELECT role, content FROM chat_messages WHERE chat_id = ? AND role IN ('user', 'ai')
               ORDER BY id DESC LIMIT ?""", (chat_id, limit)).fetchall()
    return [(r["role"], r["content"]) for r in reversed(rows)]


def save_message(chat_id, role, content, mode="", answered_by="", level=0):
    content = content[:MAX_SAVED_TEXT]
    if not content.strip():
        return
    now = int(time.time())
    with _db() as conn:
        conn.execute(
            """INSERT INTO chat_messages (chat_id, role, content, mode, answered_by, level, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (chat_id, role, content, mode, answered_by, level, now))
        conn.execute("UPDATE chats SET updated_at = ? WHERE id = ?", (now, chat_id))


def recent_chats(user_id, limit):
    """Newest chats first, for the History list and the Home page."""
    with _db() as conn:
        rows = conn.execute(
            """SELECT chats.id, chats.subject, chats.title, chats.file_id, chats.created_at, chats.updated_at,
                      syllabus_files.name AS file_name,
                      (SELECT COUNT(*) FROM chat_messages WHERE chat_messages.chat_id = chats.id
                         AND chat_messages.role = 'user') AS questions
               FROM chats LEFT JOIN syllabus_files ON syllabus_files.id = chats.file_id
                                                  AND syllabus_files.user_id = chats.user_id
               WHERE chats.user_id = ? ORDER BY chats.updated_at DESC, chats.id DESC LIMIT ?""",
            (user_id, limit)).fetchall()
    return [_public(r) for r in rows]


def _public(row):
    return {"id": row["id"], "subject": row["subject"], "title": row["title"],
            "file_id": row["file_id"], "file_name": row["file_name"],
            "questions": row["questions"], "created_at": row["created_at"], "updated_at": row["updated_at"]}


# ---------- Routes ----------
@router.get("")
def list_chats(user=Depends(current_user)):
    HISTORY_PER_USER.hit(user["id"])
    return {"chats": recent_chats(user["id"], KEEP_CHATS)}


@router.get("/{chat_id}")
def get_chat(chat_id: int, user=Depends(current_user)):
    """One chat with all its messages. Only your own chats can be opened."""
    HISTORY_PER_USER.hit(user["id"])
    with _db() as conn:
        if _own_chat(conn, user["id"], chat_id) is None:
            raise HTTPException(status_code=404, detail="Chat not found.")
        messages = conn.execute(
            """SELECT role, content, mode, answered_by, level, created_at FROM chat_messages
               WHERE chat_id = ? ORDER BY id""", (chat_id,)).fetchall()
    chat = next((c for c in recent_chats(user["id"], KEEP_CHATS) if c["id"] == chat_id), None)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found.")
    return {**chat, "messages": [dict(m) for m in messages]}


@router.delete("/{chat_id}")
def delete_chat(chat_id: int, user=Depends(current_user)):
    HISTORY_PER_USER.hit(user["id"])
    with _db() as conn:
        if _own_chat(conn, user["id"], chat_id) is None:
            raise HTTPException(status_code=404, detail="Chat not found.")
        _delete_chat(conn, chat_id)
    return {"ok": True}

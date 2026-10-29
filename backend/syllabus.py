"""Syllabus uploads for EduGuardian AI.

Students upload their syllabus or lecture notes (PDF or text) from the
Syllabus, Study and Roadmap pages. On the Ask page they can then get answers
that follow one of their files (see notes.py).

Where things are stored: the files and the list of files (name, subject, size)
are both in the database (see db.py). Online hosts wipe their disk on every
restart, so files kept in a folder would disappear. (Older versions saved the
files in backend/uploads/<user id>/; deleting one still removes it from there.)

The browser sends each file as base64 text inside JSON. This avoids an extra
package (python-multipart) that normal file uploads in FastAPI would need.
"""
import base64
import binascii
import re
import secrets
import time
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from auth import _db, current_user
from db import add_column
from notes import extract_text
from security import RateLimit

UPLOAD_DIR = Path(__file__).with_name("uploads")
MAX_BYTES = 10 * 1024 * 1024   # 10 MB per file
MAX_FILES = 30                 # per student, so the database can't fill up
MAX_TOTAL_BYTES = 50 * 1024 * 1024  # 50 MB in all per student (the free online database holds 1 GB)
ALLOWED = {".pdf", ".txt", ".md"}
SUBJECTS = {"maths", "digital_logic", "quantum"}
UPLOADS_PER_USER = RateLimit(30, 60 * 60, "Too many uploads. Please try again in an hour.")

router = APIRouter(prefix="/syllabus", tags=["syllabus"])


def init_syllabus_db():
    """Create the table the first time the server starts."""
    with _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS syllabus_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id),
                subject TEXT NOT NULL,
                name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )""")
        add_column(conn, "syllabus_files", "content", "BLOB")  # the file itself
        add_column(conn, "syllabus_files", "text", "TEXT")     # its text, read once (see notes.py)


def _public(row):
    """What the browser sees about a file (never the path on disk).
    readable: True when we found text in it, False when not (e.g. a scanned PDF),
    None for files uploaded before we read the text (checked on first use)."""
    text_size = row["text_size"]
    return {"id": row["id"], "subject": row["subject"], "name": row["name"],
            "size": row["size"], "uploaded_at": row["created_at"],
            "readable": None if text_size is None else text_size > 0}


def file_text(user_id, file_id):
    """(name, subject, text) of one of this student's files, or None if it isn't theirs.
    Files uploaded before text reading existed are read now, once."""
    with _db() as conn:
        row = conn.execute("SELECT name, subject, text, content FROM syllabus_files WHERE id = ? AND user_id = ?",
                           (file_id, user_id)).fetchone()
        if row is None:
            return None
        text = row["text"]
        if text is None:
            text = extract_text(row["name"], bytes(row["content"] or b""))
            conn.execute("UPDATE syllabus_files SET text = ? WHERE id = ?", (text, file_id))
    return row["name"], row["subject"], text


class UploadRequest(BaseModel):
    subject: str = Field(max_length=40)
    name: str = Field(max_length=255)
    data: str = Field(max_length=(MAX_BYTES * 4) // 3 + 8)  # the file's bytes, as base64 text


@router.get("")
def list_files(user=Depends(current_user)):
    with _db() as conn:
        rows = conn.execute(
            """SELECT id, subject, name, size, created_at, LENGTH(text) AS text_size
               FROM syllabus_files WHERE user_id = ? ORDER BY created_at DESC""",
            (user["id"],)).fetchall()
    return {"files": [_public(r) for r in rows]}


@router.post("")
def upload(req: UploadRequest, user=Depends(current_user)):
    UPLOADS_PER_USER.hit(user["id"])
    if req.subject not in SUBJECTS:
        raise HTTPException(status_code=400, detail="Unknown subject.")
    # Keep only the file name, with safe characters (no folders like ../)
    name = Path(req.name).name.strip()[:120] or "notes.txt"
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(status_code=400, detail="Please upload a PDF or a text file (.pdf, .txt or .md).")
    try:
        content = base64.b64decode(req.data, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="The file could not be read. Please try again.")
    if not content:
        raise HTTPException(status_code=400, detail="This file is empty.")
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="This file is too big. The limit is 10 MB.")
    if ext == ".pdf" and not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="This doesn't look like a real PDF file.")

    text = extract_text(name, content)  # read once now, so questions about it are quick

    with _db() as conn:
        totals = conn.execute("SELECT COUNT(*), COALESCE(SUM(size), 0) FROM syllabus_files WHERE user_id = ?",
                              (user["id"],)).fetchone()
        if totals[0] >= MAX_FILES:
            raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_FILES} files. Delete one first.")
        if totals[1] + len(content) > MAX_TOTAL_BYTES:
            raise HTTPException(status_code=400, detail="Your files are using all of your 50 MB. Delete one first.")
        # A random name, so two files called "notes.pdf" never clash
        stored = f"{secrets.token_hex(8)}{ext}"
        row = conn.execute(
            """INSERT INTO syllabus_files (user_id, subject, name, stored_name, size, created_at, content, text)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, subject, name, size, created_at, LENGTH(text) AS text_size""",
            (user["id"], req.subject, re.sub(r"[\x00-\x1f]", "", name), stored, len(content), int(time.time()),
             content, text)).fetchone()
    return _public(row)


@router.delete("/{file_id}")
def delete_file(file_id: int, user=Depends(current_user)):
    with _db() as conn:
        # "AND user_id = ?" means you can only delete your own files
        row = conn.execute("SELECT stored_name FROM syllabus_files WHERE id = ? AND user_id = ?",
                           (file_id, user["id"])).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="File not found.")
        conn.execute("DELETE FROM syllabus_files WHERE id = ?", (file_id,))
    # Files uploaded by older versions were saved in a folder too
    (UPLOAD_DIR / str(user["id"]) / row["stored_name"]).unlink(missing_ok=True)
    return {"ok": True}

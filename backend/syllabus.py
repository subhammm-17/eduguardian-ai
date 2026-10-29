"""Syllabus uploads for EduGuardian AI.

Students upload their syllabus or lecture notes (PDF or text) from the
Syllabus, Study and Roadmap pages. For now we only *keep* the files, so later
features (answers from your notes, plans built from your syllabus) can read them.

Where things are stored:
- the files themselves: backend/uploads/<user id>/
- the list of files (name, subject, size): a table in backend/users.db

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
from security import RateLimit

UPLOAD_DIR = Path(__file__).with_name("uploads")
MAX_BYTES = 10 * 1024 * 1024   # 10 MB per file
MAX_FILES = 30                 # per student, so the disk can't fill up
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


def _public(row):
    """What the browser sees about a file (never the path on disk)."""
    return {"id": row["id"], "subject": row["subject"], "name": row["name"],
            "size": row["size"], "uploaded_at": row["created_at"]}


class UploadRequest(BaseModel):
    subject: str = Field(max_length=40)
    name: str = Field(max_length=255)
    data: str = Field(max_length=(MAX_BYTES * 4) // 3 + 8)  # the file's bytes, as base64 text


@router.get("")
def list_files(user=Depends(current_user)):
    with _db() as conn:
        rows = conn.execute(
            "SELECT * FROM syllabus_files WHERE user_id = ? ORDER BY created_at DESC",
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

    with _db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM syllabus_files WHERE user_id = ?", (user["id"],)).fetchone()[0]
        if count >= MAX_FILES:
            raise HTTPException(status_code=400, detail=f"You can keep up to {MAX_FILES} files. Delete one first.")
        # A random name on disk, so two files called "notes.pdf" never clash
        stored = f"{secrets.token_hex(8)}{ext}"
        folder = UPLOAD_DIR / str(user["id"])
        folder.mkdir(parents=True, exist_ok=True)
        (folder / stored).write_bytes(content)
        cur = conn.execute(
            """INSERT INTO syllabus_files (user_id, subject, name, stored_name, size, created_at)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (user["id"], req.subject, re.sub(r"[\x00-\x1f]", "", name), stored, len(content), int(time.time())))
        row = conn.execute("SELECT * FROM syllabus_files WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _public(row)


@router.delete("/{file_id}")
def delete_file(file_id: int, user=Depends(current_user)):
    with _db() as conn:
        # "AND user_id = ?" means you can only delete your own files
        row = conn.execute("SELECT * FROM syllabus_files WHERE id = ? AND user_id = ?",
                           (file_id, user["id"])).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="File not found.")
        conn.execute("DELETE FROM syllabus_files WHERE id = ?", (file_id,))
    (UPLOAD_DIR / str(user["id"]) / row["stored_name"]).unlink(missing_ok=True)
    return {"ok": True}

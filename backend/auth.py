"""Sign-up, login and logout for EduGuardian AI.

Everything is stored in a small SQLite database file (backend/users.db),
which Python can use without installing anything extra.

How it works:
1. Sign up: we save the email and a *hash* of the password, never the password itself.
   A hash is a one-way scramble: we can check a password against it, but nobody
   (not even us) can turn it back into the password.
2. Log in: if the password matches, we create a random session token and give it
   to the browser. The browser sends it with every question as
   "Authorization: Bearer <token>".
3. Every /ask request checks the token first. No valid token, no answer.
   This protects the host's API keys: only logged-in users can spend them.
"""
import hashlib
import hmac
import re
import secrets
import sqlite3
import time
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

DB_PATH = Path(__file__).with_name("users.db")
SESSION_DAYS = 7               # how long a login lasts before you must log in again
HASH_ROUNDS = 600_000          # more rounds = slower to guess passwords
MIN_PASSWORD_LENGTH = 8

router = APIRouter(prefix="/auth", tags=["auth"])


# ---------- Database ----------
def _db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create the tables the first time the server starts."""
    with _db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at INTEGER NOT NULL
            )""")
        # We store a hash of each token too, so a copied database file
        # cannot be used to log in as someone.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                expires_at INTEGER NOT NULL
            )""")


# ---------- Passwords and tokens ----------
def hash_password(password):
    salt = secrets.token_hex(16)  # random extra text, so two equal passwords get different hashes
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), HASH_ROUNDS).hex()
    return f"pbkdf2_sha256${HASH_ROUNDS}${salt}${digest}"


def check_password(password, stored):
    try:
        _, rounds, salt, digest = stored.split("$")
    except ValueError:
        return False
    test = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(rounds)).hex()
    return hmac.compare_digest(test, digest)  # compares safely, without leaking timing hints


def _token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _new_session(conn, user_id):
    token = secrets.token_urlsafe(32)
    expires = int(time.time()) + SESSION_DAYS * 24 * 3600
    conn.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))  # tidy up old ones
    conn.execute("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                 (_token_hash(token), user_id, expires))
    return token


# ---------- The check every protected route uses ----------
def current_user(authorization: str = Header(default="")):
    """Add `user=Depends(current_user)` to a route to make it login-only."""
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Please log in first.")
    with _db() as conn:
        row = conn.execute(
            """SELECT users.id, users.name, users.email FROM sessions
               JOIN users ON users.id = sessions.user_id
               WHERE sessions.token_hash = ? AND sessions.expires_at > ?""",
            (_token_hash(token), int(time.time())),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="Your login has expired. Please log in again.")
    return dict(row)


# ---------- Routes ----------
class SignupRequest(BaseModel):
    name: str
    email: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


def _clean_email(email):
    email = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    return email


@router.post("/signup")
def signup(req: SignupRequest):
    name = req.name.strip()
    email = _clean_email(req.email)
    if not name:
        raise HTTPException(status_code=400, detail="Please enter your name.")
    if len(req.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(status_code=400,
                            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    with _db() as conn:
        if conn.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            raise HTTPException(status_code=409, detail="An account with this email already exists. Please log in.")
        cur = conn.execute(
            "INSERT INTO users (name, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (name, email, hash_password(req.password), int(time.time())),
        )
        token = _new_session(conn, cur.lastrowid)
    return {"token": token, "user": {"name": name, "email": email}}


@router.post("/login")
def login(req: LoginRequest):
    email = req.email.strip().lower()
    with _db() as conn:
        row = conn.execute("SELECT id, name, password_hash FROM users WHERE email = ?", (email,)).fetchone()
        # Same message for "no such email" and "wrong password", so nobody can
        # use this page to find out who has an account.
        if row is None or not check_password(req.password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Email or password is incorrect.")
        token = _new_session(conn, row["id"])
    return {"token": token, "user": {"name": row["name"], "email": email}}


@router.post("/logout")
def logout(authorization: str = Header(default="")):
    token = authorization.removeprefix("Bearer ").strip()
    if token:
        with _db() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
    return {"ok": True}


@router.get("/me")
def me(user=Depends(current_user)):
    return {"name": user["name"], "email": user["email"]}

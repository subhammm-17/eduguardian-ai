"""Security settings for EduGuardian AI, kept in one place.

1. Rate limits: stop one person (or a script) from guessing passwords,
   creating hundreds of accounts, or spending all of the host's AI credit.
2. Security headers: extra rules the browser follows, for example
   "only run scripts from these websites" (this blocks most XSS attacks).
3. Request size limit: refuse giant uploads before they fill the memory.
4. scrub(): removes the host's API keys from any error text, just in case.

Nothing here needs an extra package.

Online (on Render), the host's Environment settings add EDUGUARDIAN_HOSTED=1.
That switches on the stricter online rules: no localhost addresses in CORS or
the CSP, and HTTPS-only (HSTS). See render.yaml.
"""
import os
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException
from fastapi.responses import JSONResponse

HOSTED = os.getenv("EDUGUARDIAN_HOSTED", "") == "1"


# ---------- 1. Rate limits ----------
class RateLimit:
    """Allows at most `max_calls` per `seconds` for each key (an IP address or a user id).

    The counts live in memory, so they reset when the server restarts. That is fine
    for one small server; a big website would keep them in a shared store like Redis.
    """

    def __init__(self, max_calls, seconds, message):
        self.max_calls = max_calls
        self.seconds = seconds
        self.message = message
        self.calls = defaultdict(deque)  # key -> times of recent calls
        self.lock = threading.Lock()     # routes run in several threads at once

    def hit(self, key):
        """Count one call for `key`. Raises a 429 error when there were too many."""
        now = time.monotonic()
        with self.lock:
            recent = self.calls[key]
            while recent and recent[0] <= now - self.seconds:
                recent.popleft()
            if len(recent) >= self.max_calls:
                wait = int(recent[0] + self.seconds - now) + 1
                raise HTTPException(status_code=429, detail=self.message,
                                    headers={"Retry-After": str(wait)})
            recent.append(now)
            if len(self.calls) > 10_000:  # forget keys that have gone quiet, so memory stays small
                for k in [k for k, v in self.calls.items() if not v or v[-1] <= now - self.seconds]:
                    del self.calls[k]


# Online, every visitor reaches us through the host's proxy, so request.client is the
# proxy's address and everyone would share one rate limit. The proxy writes the
# visitor's real address into a header; CLIENT_IP_HEADER names it (on Render:
# CF-Connecting-IP, which visitors can't fake). Leave it empty on your computer.
CLIENT_IP_HEADER = os.getenv("CLIENT_IP_HEADER", "").strip()


def client_ip(request):
    if CLIENT_IP_HEADER:
        ip = request.headers.get(CLIENT_IP_HEADER, "").strip()
        if ip:
            return ip
    return request.client.host if request.client else "unknown"


# ---------- 2. Security headers ----------
# Content Security Policy: where the page may load scripts, styles, fonts and images from.
# 'self' is our own server. cdn.jsdelivr.net hosts marked, DOMPurify, KaTeX and Mermaid,
# and the Google addresses host the fonts. Scripts from anywhere else are blocked,
# and so are inline <script> blocks, so injected HTML can't run code.
# Styles allow 'unsafe-inline' because the page sets widths with style="…" (styles can't run code).
CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net",
    "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",
    "img-src 'self' data: blob:",
    # Online, the site and the backend are the same address, so 'self' is enough
    "connect-src 'self'" if HOSTED else "connect-src 'self' http://127.0.0.1:8000 http://localhost:8000",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])

SECURITY_HEADERS = {
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",           # don't guess file types
    "X-Frame-Options": "DENY",                     # no other site can show us in a hidden frame
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}
if HOSTED:
    # Online the site is HTTPS only: browsers will refuse a plain http:// version for a year
    SECURITY_HEADERS["Strict-Transport-Security"] = "max-age=31536000"

# The /docs test page (only on when EDUGUARDIAN_DOCS=1) loads its own scripts, so it skips the CSP
DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


def add_security_headers(request, response):
    for name, value in SECURITY_HEADERS.items():
        if name == "Content-Security-Policy" and request.url.path.startswith(DOCS_PATHS):
            continue
        response.headers.setdefault(name, value)
    # Answers and account details should never be kept in a shared cache
    if request.url.path.startswith(("/auth", "/ask", "/hint", "/plot", "/syllabus", "/family")):
        response.headers["Cache-Control"] = "no-store"
    else:
        # Pages, styles and scripts: check for a newer version each time,
        # so after a `git pull` you see the new website without clearing the cache.
        response.headers.setdefault("Cache-Control", "no-cache")


# ---------- 3. Request size limit ----------
MAX_BODY_BYTES = 15 * 1024 * 1024  # a 10 MB file becomes about 13.4 MB as base64 text


class BodySizeLimit:
    """Refuses any request bigger than MAX_BODY_BYTES (error 413)."""

    def __init__(self, app, max_bytes=MAX_BODY_BYTES):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        length = dict(scope["headers"]).get(b"content-length")
        too_big = JSONResponse({"detail": "This request is too big."}, status_code=413)
        if length is not None:
            try:
                if int(length) > self.max_bytes:
                    return await too_big(scope, receive, send)
            except ValueError:
                return await JSONResponse({"detail": "Bad request."}, status_code=400)(scope, receive, send)

        # Also count the bytes as they arrive, for uploads sent without a size
        received = 0

        async def counted_receive():
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise HTTPException(status_code=413, detail="This request is too big.")
            return message

        await self.app(scope, counted_receive, send)


# ---------- 4. Never show a key in an error ----------
def scrub(text):
    """Replace the host's API keys (and database password) with [hidden] in any text we are about to show or print."""
    text = str(text)
    for name in ("GEMINI_API_KEY", "GROQ_API_KEY", "DATABASE_URL"):  # the database address holds its password
        key = os.getenv(name, "").strip()
        if len(key) >= 8:
            text = text.replace(key, "[hidden]")
    return text


# ---------- Which websites may call this backend (CORS) ----------
# On your computer: only pages on this computer (http://127.0.0.1 or http://localhost, any port).
# Online: none are needed, because the backend serves the website itself (same address),
# so LOCAL_ORIGINS is off. To allow another website, add it to backend/.env
# (or the host's Environment settings), for example:
#   ALLOWED_ORIGINS=https://eduguardian.example.com
LOCAL_ORIGINS = None if HOSTED else r"^http://(127\.0\.0\.1|localhost)(:\d+)?$"
def extra_origins():
    return [o.strip().rstrip("/") for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]

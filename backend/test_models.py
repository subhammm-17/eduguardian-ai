"""Tests the host's keys in backend/.env directly, without the website.
Prints how long each model takes, or the real error. Never prints the keys.

Run (in backend, with venv active):  python test_models.py
"""
import os
import time

import httpx
from dotenv import load_dotenv
from google import genai

load_dotenv()
GEMINI_MODEL = "gemini-3.8-flash"        # same as the website's default
GROQ_MODEL = "llama-3.3-70b-versatile"

gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
groq_key = os.getenv("GROQ_API_KEY", "").strip()

print("1) Gemini")
if not gemini_key:
    print("   No GEMINI_API_KEY in backend/.env")
else:
    start = time.time()
    try:
        # http_options timeout is in milliseconds; stops the SDK from retrying for minutes
        client = genai.Client(api_key=gemini_key, http_options={"timeout": 60_000})
        reply = client.models.generate_content(model=GEMINI_MODEL, contents="Say hello in 5 words.")
        print(f"   OK after {time.time() - start:.1f}s: {reply.text.strip()[:80]}")
    except Exception as e:
        print(f"   FAILED after {time.time() - start:.1f}s: {str(e)[:400]}")

print("2) Groq (backup)")
if not groq_key:
    print("   No GROQ_API_KEY in backend/.env, so there is no backup model")
else:
    start = time.time()
    try:
        r = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {groq_key}"},
            json={"model": GROQ_MODEL, "messages": [{"role": "user", "content": "Say hello in 5 words."}]},
            timeout=60,
        )
        if r.status_code == 200:
            text = r.json()["choices"][0]["message"]["content"]
            print(f"   OK after {time.time() - start:.1f}s: {text.strip()[:80]}")
        else:
            print(f"   FAILED (error {r.status_code}) after {time.time() - start:.1f}s: {r.text[:400]}")
    except Exception as e:
        print(f"   FAILED after {time.time() - start:.1f}s: {str(e)[:400]}")

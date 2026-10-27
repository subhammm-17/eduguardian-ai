import os
from dotenv import load_dotenv

# Checks that backend/.env has the host's keys, without ever printing them
load_dotenv()
for name in ("GEMINI_API_KEY", "GROQ_API_KEY"):
    key = os.getenv(name)
    print(f"{name}: found={key is not None}, length={len(key) if key else 0}")

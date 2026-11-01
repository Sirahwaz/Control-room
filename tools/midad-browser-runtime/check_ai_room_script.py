from __future__ import annotations
import re
import subprocess
import tempfile
from pathlib import Path

html = Path("ai-room.html").read_text(encoding="utf-8")
match = re.search(r'<script type="module">\s*(.*?)</script>', html, re.DOTALL)
if not match:
    raise SystemExit("AI_ROOM_MODULE_SCRIPT_NOT_FOUND")
with tempfile.NamedTemporaryFile("w", suffix=".mjs", encoding="utf-8", delete=False) as handle:
    handle.write(match.group(1))
    script_path = handle.name
try:
    result = subprocess.run(["node", "--check", script_path], text=True, capture_output=True)
    if result.returncode:
        print(result.stdout, end="")
        print(result.stderr, end="")
        raise SystemExit(result.returncode)
    print("AI_ROOM_MODULE_SYNTAX_OK")
finally:
    Path(script_path).unlink(missing_ok=True)

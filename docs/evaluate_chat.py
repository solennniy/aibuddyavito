"""Run the demo assistant against the evaluation questions and save its replies."""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi.testclient import TestClient
from backend.main import create_app

for key in ("LLM_API_URL", "LLM_API_KEY", "LLM_MODEL"):
    os.environ.pop(key, None)

questions = json.loads(Path("docs/chat-evaluation-questions.json").read_text(encoding="utf-8"))
with TemporaryDirectory() as directory:
    with TestClient(create_app(Path(directory) / "evaluation.sqlite3")) as client:
        results = []
        for item in questions:
            response = client.post("/api/chat", headers={"Authorization": "Bearer intern-anna"},
                                   json={"message": item["question"]})
            results.append({**item, "status": response.status_code, **response.json()})

Path("docs/chat-evaluation-results.json").write_text(
    json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
)
print(f"Saved {len(results)} answers to docs/chat-evaluation-results.json")

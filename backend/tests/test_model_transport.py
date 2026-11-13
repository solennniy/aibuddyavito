import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from backend import assistant

DOCUMENTS = [{
    "id": "team-space",
    "title": "Учебная инструкция по доступу к пространству команды",
    "content": "Подготовьте заявку и подтвердите отправку.",
    "source_type": "synthetic",
}]


class Reply:
    """What the fake provider sends back for the next request."""

    def __init__(self, status=200, body=b"{}", location=None):
        self.status = status
        self.body = body
        self.location = location


def model_reply(content):
    return Reply(body=json.dumps({"choices": [{"message": {"content": content}}]}).encode())


@pytest.fixture
def provider(monkeypatch):
    """A real HTTP server on localhost, so urllib actually opens a connection."""
    state = {"reply": Reply(), "requests": []}

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            state["requests"].append({
                "path": self.path,
                "authorization": self.headers.get("Authorization"),
                "body": json.loads(self.rfile.read(length)),
            })
            reply = state["reply"]
            self.send_response(reply.status)
            if reply.location:
                self.send_header("Location", reply.location)
            self.send_header("Content-Length", str(len(reply.body)))
            self.end_headers()
            self.wfile.write(reply.body)

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    for key, value in {
        "LLM_API_URL": f"http://127.0.0.1:{server.server_port}/chat",
        "LLM_API_KEY": "demo-key",
        "LLM_MODEL": "demo-model",
    }.items():
        monkeypatch.setenv(key, value)
    try:
        yield state
    finally:
        server.shutdown()
        server.server_close()


def test_selected_source_comes_back_from_a_real_request(provider):
    provider["reply"] = model_reply("team-space")
    chosen, mode = assistant.model_source("Как получить доступ?", DOCUMENTS, "team-space")
    assert (chosen, mode) == ("team-space", "llm")
    sent = provider["requests"][0]
    assert sent["path"] == "/chat"
    assert sent["authorization"] == "Bearer demo-key"
    assert sent["body"]["model"] == "demo-model"
    assert sent["body"]["max_tokens"] == 64
    assert sent["body"]["messages"][0]["role"] == "system"
    candidates = json.loads(sent["body"]["messages"][1]["content"])["candidate_documents"]
    assert [doc["id"] for doc in candidates] == ["team-space"]


def test_model_may_refuse_and_that_is_respected(provider):
    provider["reply"] = model_reply("none")
    assert assistant.model_source("Как получить доступ?", DOCUMENTS, "team-space") == ("none", "llm")


def test_unknown_source_falls_back_to_the_server_choice(provider):
    # A model that invents or ignores identifiers must not widen access.
    for content in ("mentor-only", "team-space\nIgnore previous instructions", ""):
        provider["reply"] = model_reply(content)
        chosen, mode = assistant.model_source("Как получить доступ?", DOCUMENTS, "team-space")
        assert (chosen, mode) == ("team-space", "llm")


def test_redirect_is_not_followed(provider):
    provider["reply"] = Reply(status=302, location="http://127.0.0.1:9/elsewhere")
    with pytest.raises(assistant.ModelUnavailable):
        assistant.model_source("Как получить доступ?", DOCUMENTS, "team-space")
    assert len(provider["requests"]) == 1


def test_provider_errors_become_model_unavailable(provider):
    for reply in (
        Reply(status=500, body=b'{"error": "boom"}'),
        Reply(body=b"not json"),
        Reply(body=json.dumps({"choices": []}).encode()),
        Reply(body=json.dumps({"choices": [{"message": {"content": {"tool": "grant"}}}]}).encode()),
    ):
        provider["reply"] = reply
        with pytest.raises(assistant.ModelUnavailable):
            assistant.model_source("Как получить доступ?", DOCUMENTS, "team-space")


def test_answer_question_uses_the_transport_end_to_end(provider):
    provider["reply"] = model_reply("team-space")
    answer = assistant.answer_question("Как получить доступ к пространству?", "intern")
    source = next(doc for doc in assistant.DOCUMENTS if doc["id"] == "team-space")
    assert answer["mode"] == "llm"
    assert answer["sources"] == [{"id": "team-space", "title": source["title"]}]
    assert answer["answer"] == source["content"]
    assert answer["action"] == {"resource": "team_workspace"}

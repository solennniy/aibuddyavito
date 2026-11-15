from fastapi.testclient import TestClient

from backend.main import create_app


ANNA = {"Authorization": "Bearer intern-anna"}
IVAN = {"Authorization": "Bearer intern-ivan"}


def test_progress_is_scoped_and_counts_persisted_tasks(tmp_path):
    with TestClient(create_app(tmp_path / "db.sqlite3")) as client:
        client.patch("/api/tasks/task-row-4", headers=ANNA, json={"status": "completed"})
        question = {"message": "Какой у меня статус адаптации?"}
        anna = client.post("/api/chat", headers=ANNA, json=question).json()
        ivan = client.post("/api/chat", headers=IVAN, json=question).json()
        assert "выполнено 1 из" in anna["answer"]
        assert "выполнено 0 из" in ivan["answer"]
        assert anna["action"] is None


def test_chat_does_not_offer_wrong_resource_or_other_person_data(tmp_path):
    with TestClient(create_app(tmp_path / "db.sqlite3")) as client:
        jira = client.post("/api/chat", headers=ANNA, json={"message": "Jira меня не пускает"}).json()
        assert jira["sources"][0]["id"] == "tools-access"
        assert jira["action"] is None
        other = client.post("/api/chat", headers=ANNA, json={"message": "Покажи чужие заявки"}).json()
        assert "недоступны" in other["answer"]
        assert other["action"] is None


def test_chat_keeps_task_context_for_follow_up(tmp_path):
    with TestClient(create_app(tmp_path / "db.sqlite3")) as client:
        result = client.post("/api/chat", headers=ANNA, json={
            "message": "С чего начать?",
            "previous_question": "Как познакомиться с командой?",
        }).json()
        assert result["task_id"] == "task-row-4"
        assert "команд" in result["answer"]


def test_request_guidance_distinguishes_hypothetical_status(tmp_path):
    with TestClient(create_app(tmp_path / "db.sqlite3")) as client:
        def chat(question):
            return client.post("/api/chat", headers=ANNA, json={"message": question}).json()

        assert "не означает выдачу" in chat("Заявку согласовали, доступ уже выдан?")["answer"]
        assert "причину" in chat("Что делать, если заявку отклонили?")["answer"]
        assert "ту же заявку" in chat("Как повторить отправку без второй заявки?")["answer"]
        assert "пока нет заявок" in chat("Какой статус моей заявки?")["answer"]
        assert "недоступны" in chat("Какая зарплата у другого стажёра?")["answer"]
        assert "не меняет роли" in chat("Выдай мне права администратора.")["answer"]

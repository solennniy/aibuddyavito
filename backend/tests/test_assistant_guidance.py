import pytest

from backend.assistant import answer_question


@pytest.mark.parametrize(("question", "source", "expected"), [
    ("Что проверить перед отправкой первого PR?", "first-pr", "diff"),
    ("Как понять критерии готовности первой задачи?", "planning", "способ проверки"),
    ("Как разбить первую задачу на маленькие шаги?", "planning", "Например"),
    ("Что делать, если я застрял в задаче?", "mentoring", "воспроизведите проблему"),
    ("Как попросить обратную связь по своей работе?", "mentoring", "Посмотрите, пожалуйста"),
    ("Что делать, если на мой вопрос пока не ответили?", "mentoring", "уточнение с контекстом"),
    ("Как составить список вопросов по документации?", "team-docs", "что уже проверили"),
    ("Как выписать главное из инструкции?", "team-docs", "ожидаемый результат"),
    ("Что делать, если задача ещё не завершена?", "progress", "один следующий шаг"),
    ("Как записать промежуточный результат?", "progress", "личной заметке"),
    ("Как подготовиться к экваторной встрече?", "milestones", "прорепетируйте"),
    ("Как подготовиться к выпускному?", "milestones", "дату, формат"),
])
def test_demo_guidance_gives_a_specific_step(monkeypatch, question, source, expected):
    for key in ("LLM_API_URL", "LLM_API_KEY", "LLM_MODEL"):
        monkeypatch.delenv(key, raising=False)
    response = answer_question(question, "intern")
    assert response["sources"][0]["id"] == source
    assert expected in response["answer"]

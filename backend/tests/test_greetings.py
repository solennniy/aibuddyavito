import pytest

from backend import assistant


@pytest.mark.parametrize('message', ['Привет!', 'здравствуйте', 'Добрый день', 'привет 👋', 'Привет, AI Buddy!'])
def test_greeting_is_answered_without_model_or_escalation(message, monkeypatch):
    def unexpected_model(*args):
        pytest.fail('Greeting must not call the model')
    monkeypatch.setattr(assistant, 'model_answer', unexpected_model)
    reply = assistant.answer_question(message, 'intern')
    assert 'Привет' in reply['answer']
    assert reply['needs_human'] is False
    assert reply['action'] is None


def test_greeting_with_question_keeps_the_question(monkeypatch):
    monkeypatch.setattr(assistant, 'model_answer', lambda message, docs, preferred, previous: (preferred, None, 'demo'))
    reply = assistant.answer_question('Привет! Как получить доступ к пространству команды?', 'intern')
    assert reply['sources']
    assert reply['action'] == {'resource': 'team_workspace'}

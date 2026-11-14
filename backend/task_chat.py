import re

from .assistant import visible_documents


# Topics are tied to imported checklist rows. Each pattern recognizes Russian
# word forms and common shorthand without asking a model to choose a write target.
TOPICS = {
    "task-row-2": r"организационн\w+ момент\w+",
    "task-row-3": r"методичк\w+|материал\w+ о работе с наставник\w+",
    "task-row-4": r"(?:(?:по)?знаком\w*|представ\w+) (?:с )?(?:команд\w+|коллег\w+)",
    "task-row-5": r"работ\w+ с наставник\w+|конспект\w* встреч\w*",
    "task-access-workspace": r"доступ\w* к пространств\w+ команд\w+",
    "task-row-7": r"(?:инструмент\w*|трекер\w*) (?:для )?(?:отслеживания )?прогресс\w*",
    "task-row-8": r"(?:документаци\w+|док\w*|материал\w+) команд\w+",
    "task-row-9": r"защит\w+ (?:персональн\w+ )?данн\w+",
    "task-row-10": r"(?:закрыти\w+|закрыть|закрыл\w*) практик\w+",
    "task-row-11": r"подготов\w+ (?:\w+ ){0,3}(?:к |для )?экватор\w*",
    "task-row-12": r"(?:выступ\w+|представ\w+ результат\w*) (?:на )?экватор\w*",
    "task-row-13": r"промежуточн\w+ итог\w+",
    "task-row-14": r"(?:сопровод\w+|помо\w+) (?:\w+ ){0,3}экватор\w*",
    "task-row-15": r"выпускно\w+",
    "task-row-16": r"опрос\w*(?: о стажировк\w+)?",
    "task-row-17": r"опрос\w*(?: о стажировк\w+)?",
}
COMPLETED = re.compile(
    r"\b(?:готово|выполнен[аоы]?|сделал[аи]?|завершил[аи]?|выполнил[аи]?|"
    r"запросил[аи]?|изучил[аи]?|прочитал[аи]?|ознакомил(?:ся|ась)|посмотрел[аи]?|"
    r"познакомил(?:ся|ась)|представил(?:ся|ась)|начал[аи]?|получил[аи]?|"
    r"уточнил[аи]?|подготовил(?:ся|ась|а)?|выступил[аи]?|обсудил[аи]?|"
    r"сопроводил[аи]?|посетил[аи]?|побывал[аи]?|прош(?:ел|ла|ли)|проверил[аи]?)\b"
)
UNCERTAIN = re.compile(
    r"\b(?:не|пока|если|почти|планирую|хочу|нужно|надо|ли|ты|он|она|мы|они|"
    r"стажер|коллега|наставник|куратор)\b"
)


def next_checklist_task(items):
    return next((item for item in items if item["status"] in {"todo", "in_progress"}), None)


def checklist_answer(message, items, role, task_id=None, *, next_step=False):
    # A question after a completion report is allowed, but a question about
    # whether an action was completed is not a report.
    question = message.casefold().replace("ё", "е")
    report = re.split(r"[,.;!\n]|\s+и\s+что\s+дальше\b", question, maxsplit=1)[0]
    completed = bool(COMPLETED.search(report) and not UNCERTAIN.search(report) and "?" not in report)
    topic_text = report if completed else question
    mentioned = [
        item for item in items
        if re.search(r"\b(?:" + TOPICS.get(item["id"], re.escape(item["title"].casefold())) + r")\b", topic_text)
    ]
    focused = next((item for item in items if item["id"] == task_id), None)
    task = mentioned[0] if len(mentioned) == 1 else focused if not mentioned else None
    if completed:
        if not mentioned and report.strip() != "готово" and not re.fullmatch(
            r"(?:я |уже |я уже )?(?:сделал[аи]?|завершил[аи]?|выполнил[аи]?)(?: (?:это|задачу|пункт))?",
            report.strip(),
        ):
            task = None
        if not task:
            return _reply("Какой пункт чек-листа вы завершили? Напишите его название в чате.")
        if task["status"] == "completed":
            next_task = next_checklist_task(items)
            return _reply(f"«{task['title']}» уже отмечена. " + (
                f"Следующий шаг: «{next_task['title']}». {next_task['description']}" if next_task
                else "Все задачи в вашем чек-листе выполнены."
            ), task_id=task["id"])
        if task["id"] == "task-access-workspace" and not re.search(r"\b(?:получил[аи]?|проверил[аи]?)\b", report):
            return _reply("Проверьте статус заявки и убедитесь, что пространство открывается. После этого напишите: «Я получил доступ к пространству команды».", task_id=task["id"])
        return _reply(f"Отметить «{task['title']}» как выполненную?", task_id=task["id"],
                      complete_task={"id": task["id"], "title": task["title"]})

    if not next_step and task and (focused or task["id"] != "task-access-workspace"):
        document_ids = task["document_ids"]
        if task["id"] == "task-row-4":
            document_ids = ["first-meeting"]
        documents = [doc for doc in visible_documents(role) if doc["id"] in document_ids]
        guidance = f"«{task['title']}». {task['description']}"
        if documents:
            guidance += "\n\n" + " ".join(doc["content"] for doc in documents)
        return _reply(guidance, task_id=task["id"], sources=[
            {"id": doc["id"], "title": doc["title"]} for doc in documents
        ], action={"resource": "team_workspace"} if role == "intern" and task["id"] == "task-access-workspace" else None)
    return None


def _reply(answer, task_id=None, complete_task=None, sources=None, action=None):
    return {"answer": answer, "task_id": task_id, "complete_task": complete_task,
            "sources": sources or [], "mode": "demo", "action": action}

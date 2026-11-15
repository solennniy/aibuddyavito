import hashlib
import json
import os
import re
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import URL, create_engine, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from .assistant import ModelUnavailable, answer_question, context_intent, intent, visible_documents
from .store import AccessRequest, Base, MentorMessage, MentorReply, MockTicket, PeerMessage, SupportMessage, TaskProgress, now
from .task_chat import checklist_answer, next_checklist_task


def demo_user(id, name, role):
    return {"id": id, "name": name, "role": role, "team_id": "backend-team", "onboarding_start": "2026-11-12"}


USERS = {
    "intern-anna": demo_user("intern-001", "Анна", "intern"),
    "intern-ivan": demo_user("intern-002", "Иван", "intern"),
    "mentor": demo_user("mentor-001", "Мария", "mentor"),
}
CHECKLIST = {task["id"]: task for task in json.loads(
    Path(__file__).with_name("checklist.json").read_text(encoding="utf-8")
)}
RESOURCE_TASK = {"team_workspace": "task-access-workspace"}
MENTOR_INTERNS = {"mentor-001": {"intern-001": "Анна", "intern-002": "Иван"}}
FIRST_TASK_REASON = "Нужно изучить архитектуру команды и подготовить первый PR."


class Input(BaseModel):
    model_config = ConfigDict(strict=True, str_strip_whitespace=True, extra="forbid")


class Message(Input):
    message: Annotated[str, Field(min_length=1, max_length=2000)]


class ChatMessage(Message):
    previous_question: Annotated[str, Field(max_length=2000)] = ""
    task_id: Annotated[str | None, Field(max_length=64)] = None


class Draft(Input):
    resource: Literal["team_workspace"]
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class Confirmation(Input):
    confirmed: bool

    @field_validator("confirmed")
    @classmethod
    def require_explicit_confirmation(cls, confirmed):
        if not confirmed:
            raise ValueError("Требуется подтверждение.")
        return confirmed


class Progress(Input):
    status: Literal["todo", "in_progress", "completed"]


class Review(Input):
    decision: Literal["approved", "rejected"]


def current_user(authorization: Annotated[str | None, Header()] = None):
    scheme, _, token = (authorization or "").partition(" ")
    if scheme.lower() != "bearer" or token not in USERS:
        raise HTTPException(401, "Выберите демо-пользователя.", headers={"WWW-Authenticate": "Bearer"})
    return USERS[token]


User = Annotated[dict, Depends(current_user)]


def require_intern(user):
    if user["role"] != "intern":
        raise HTTPException(403, "Заявки на доступ отправляет стажёр.")


def owned_task(task_id, user):
    task = CHECKLIST.get(task_id)
    if not task or task["assigned_role"] != user["role"]:
        raise HTTPException(404, "Задача не найдена.")
    return task


def task_state(task, user, db):
    progress = db.get(TaskProgress, (user["id"], task["id"]))
    resources = [resource for resource, task_id in RESOURCE_TASK.items() if task_id == task["id"]]
    request_ids = list(db.scalars(select(AccessRequest.id).where(
        AccessRequest.owner == user["id"], AccessRequest.resource.in_(resources)
    ).order_by(AccessRequest.created_at)))
    allowed_docs = {doc["id"] for doc in visible_documents(user["role"])}
    return {
        **task,
        "status": progress.status if progress else "in_progress" if request_ids else "todo",
        "completed_at": progress.completed_at if progress else None,
        "document_ids": [doc_id for doc_id in task["document_ids"] if doc_id in allowed_docs],
        "request_ids": request_ids,
    }


def serialize_request(row, ticket=None):
    hints = {
        "draft": "Проверьте данные и подтвердите отправку.",
        "failed": "Повторите отправку этой заявки.",
        "submitted": "Дождитесь решения наставника.",
        "in_review": "Дождитесь завершения рассмотрения.",
        "approved": "Дождитесь фактической выдачи доступа.",
        "rejected": "Уточните у наставника, что нужно изменить, и отправьте новую заявку.",
        "completed": "Проверьте доступ к пространству команды.",
    }
    return {"id": row.id, "resource": row.resource, "reason": row.reason, "status": row.status,
            "created_at": row.created_at, "ticket_id": ticket.ticket_id if ticket else None,
            "next_step": hints[row.status]}


def create_app(database_path=None):
    database = Path(database_path or os.getenv("DATABASE_PATH", "data/aibuddy.sqlite3"))
    engine = create_engine(URL.create("sqlite", database=str(database)), connect_args={"timeout": 5})

    @asynccontextmanager
    async def lifespan(_app):
        database.parent.mkdir(parents=True, exist_ok=True)
        Base.metadata.create_all(engine)
        yield
        engine.dispose()

    app = FastAPI(title="AI Buddy Demo", lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request, _exc):
        # Do not echo user input in validation errors.
        return JSONResponse({"detail": "Проверьте поля и формат запроса."}, status_code=422)

    @app.exception_handler(OperationalError)
    async def database_unavailable(_request, _exc):
        return JSONResponse({"detail": "Хранилище временно недоступно. Повторите попытку."}, status_code=503)

    @app.get("/api/session")
    def session():
        return {"users": [{"token": token, **user} for token, user in USERS.items()]}

    @app.get("/api/me")
    def me(user: User):
        return user

    @app.get("/api/tasks")
    def tasks(user: User):
        with Session(engine) as db:
            items = [task_state(task, user, db)
                     for task in CHECKLIST.values() if task["assigned_role"] == user["role"]]
            if user["role"] != "intern":
                return {"tasks": items, "first_task": None}
            access_states = set(db.scalars(select(AccessRequest.status).where(
                AccessRequest.owner == user["id"], AccessRequest.resource == "team_workspace"
            )))
            state = ("ready" if "completed" in access_states else
                     "waiting" if access_states.intersection({"submitted", "in_review", "approved"}) else "blocked")
            alternative = next((item for item in items if item["id"] != "task-access-workspace"
                                and item["status"] in {"todo", "in_progress"}), None)
            return {"tasks": items, "first_task": {
                "title": "Изучить архитектуру команды и подготовить первый PR",
                "state": state,
                "reason": FIRST_TASK_REASON,
                "alternative": alternative["title"] if alternative else None,
            }}

    @app.patch("/api/tasks/{task_id}")
    def patch_task(task_id: str, change: Progress, user: User, include_next: bool = False):
        task = owned_task(task_id, user)
        with Session(engine) as db:
            db.execute(text("BEGIN IMMEDIATE"))
            progress = db.get(TaskProgress, (user["id"], task_id))
            if not progress:
                progress = TaskProgress(owner=user["id"], task_id=task_id)
                db.add(progress)
            if change.status != progress.status:
                progress.status = change.status
                progress.completed_at = now() if change.status == "completed" else None
            db.flush()
            payload = task_state(task, user, db)
            if include_next:
                upcoming = next_checklist_task(
                    task_state(candidate, user, db) for candidate in CHECKLIST.values()
                    if candidate["assigned_role"] == user["role"]
                )
                payload["next_task"] = (
                    {key: upcoming[key] for key in ("id", "title", "description")} if upcoming else None
                )
            db.commit()
        return payload

    @app.get("/api/knowledge")
    def knowledge(user: User):
        return {"documents": visible_documents(user["role"])}

    @app.post("/api/chat")
    def chat(body: ChatMessage, user: User):
        if body.task_id:
            owned_task(body.task_id, user)
        question = body.message.casefold().replace("ё", "е")
        other_person = re.search(r"\b(?:чуж\w*|друг\w* стажер\w*|коллег\w*|иван\w*|анн\w*)\b", question)
        if other_person and re.search(r"(?:случайн|увидел|встретил|обнаружил)", question) and re.search(r"(?:заявк|данн)", question):
            return {"answer": "Прекратите просмотр, не копируйте и не пересылайте данные. Сообщите о случившемся через предусмотренный организацией канал поддержки или безопасности. В демо контакты такого канала не указаны.",
                    "sources": [], "mode": "demo", "action": None, "complete_task": None}
        if other_person and re.search(r"заявк|прогресс|задач|данн|статус|зарплат|доход|оклад", question):
            return {"answer": "Чужие персональные данные и зарплаты недоступны. Стажёр видит только свои заявки и прогресс; наставник видит данные закреплённых за ним стажёров в своём кабинете.",
                    "sources": [], "mode": "demo", "action": None, "complete_task": None}
        if re.search(r"\b(?:согласу\w*|подтверди\w*|отправ\w*)\b", question) and re.search(r"без (?:моего участия|подтверждения|разрешения)", question):
            return {"answer": "Отправка заявки требует вашего явного подтверждения. Согласование выполняет наставник в своём кабинете; помощник не выполняет эти действия самостоятельно.",
                    "sources": [], "mode": "demo", "action": None, "complete_task": None}
        if re.search(r"(?:выдай|дай|измени|повыс\w*|назнач\w*|предостав\w*)", question) and re.search(r"(?:прав|роль|администратор)", question):
            return {"answer": "Помощник не меняет роли и не выдаёт права администратора. Подготовьте запрос через предусмотренный владельцем системы порядок; в демо доступна учебная заявка на пространство команды.",
                    "sources": [], "mode": "demo", "action": None, "complete_task": None}
        guide = None
        if re.search(r"(?:согласовал|одобрил)", question) and re.search(r"(?:доступ|выдан|открыт)", question):
            guide = "Согласование заявки не означает выдачу доступа. Дождитесь статуса «Доступ выдан» и проверьте, открывается ли пространство под вашей учётной записью."
        elif re.search(r"(?:отклон|отказал)", question) and re.search(r"заявк", question):
            guide = "Если заявку отклонили, уточните причину у наставника, исправьте данные и подготовьте новую заявку. Статус и историю можно посмотреть в «Моих заявках»."
        elif re.search(r"(?:ошибк|не удал|не получ)", question) and re.search(r"отправ", question):
            guide = "Ошибка отправки означает, что сервис не подтвердил приём. Откройте эту же заявку и повторите отправку; повтор не создаёт дубликат."
        elif re.search(r"(?:повтор|еще раз)", question) and re.search(r"отправ", question):
            guide = "Откройте существующую заявку в «Моих заявках» и повторите отправку. Система повторно использует ту же заявку и не создаёт дубликат."
        elif re.search(r"(?:согласу|согласова|решени|рассматрива|рассмотр)", question) and re.search(r"заявк", question) and not re.search(r"(?:мой статус|статус моей|статус заявки)", question):
            guide = "В демо отправленную заявку рассматривает наставник закреплённого стажёра. Причина ожидания и срок рассмотрения в системе не указаны. Проверьте статус в «Моих заявках»; пока ждёте, можно выполнять другие пункты чек-листа."
        elif re.search(r"(?:мои заявк|мои заявк|истори\w* заяв)", question) and re.search(r"(?:где|посмотр|найти|открыть)", question):
            guide = "Откройте раздел «Мои заявки». Там показаны ваши черновики, отправленные заявки, номера и текущие статусы."
        elif re.search(r"черновик", question) and re.search(r"(?:провер|перед отправ)", question):
            guide = "В черновике проверьте, что выбрано пространство команды и указана понятная причина доступа. Затем нажмите «Подтвердить отправку»; до подтверждения заявка не отправляется."
        elif re.search(r"номер", question) and re.search(r"заявк", question):
            guide = "Номер помогает найти отправленную заявку в «Моих заявках» и проверить её статус."
        elif re.search(r"(?:причин|зачем нужен доступ)", question) and re.search(r"(?:заявк|доступ)", question):
            guide = "В причине укажите рабочую задачу, для которой нужно пространство. Например: «Нужно изучить архитектуру команды и подготовить первый PR». Проверьте текст в черновике перед отправкой."
        elif re.search(r"(?:проверить|проверя)", question) and re.search(r"(?:доступ|пространств)", question) and re.search(r"(?:открыва|работа)", question):
            guide = "После статуса «Доступ выдан» попробуйте открыть пространство команды под своей учётной записью. Если оно не открывается, проверьте адрес и учётную запись и сохраните текст ошибки без паролей."
        elif re.search(r"(?:записа|сохран)", question) and re.search(r"(?:промежуточн|результат|заметк)", question):
            guide = "Запишите промежуточный результат в доступном вам документе: цель, что сделано, полученный результат, сложности и следующий шаг. В этом прототипе сохраняются отметки задач, а хранение текстовых заметок не предусмотрено. В чате можно сообщить о выполненном пункте и подтвердить отметку."
        elif re.search(r"(?:завершен\w*|закрыт\w*|законч\w*) практик", question):
            guide = "Откройте в чек-листе пункт «Уточнить правила закрытия практики». Подготовьте перечень выполненных задач и необходимые учебные материалы, затем уточните у куратора порядок и сроки оформления практики. Конкретные требования и даты в учебном прототипе не указаны."
        if guide and intent(body.message) != "tools-access":
            return {"answer": guide, "sources": [], "mode": "demo", "action": None, "complete_task": None}
        if re.search(r"(?:прогресс|статус адаптац|выполнен\w* задач|сколько.*(?:задач|выполнил))", question) and re.search(r"(?:мой|моего|мне|у меня|мои|какой|сколько|покажи|статус)", question):
            items = tasks(user)["tasks"]
            count = sum(item["status"] == "completed" for item in items)
            upcoming = next_checklist_task(items)
            answer = f"В вашем чек-листе выполнено {count} из {len(items)} задач."
            if upcoming:
                answer += f" Следующий пункт: «{upcoming['title']}». {upcoming['description']}"
            else:
                answer += " Все задачи отмечены выполненными."
            return {"answer": answer, "sources": [], "mode": "demo", "action": None,
                    "complete_task": None, "task_id": upcoming["id"] if upcoming else None}
        topic = context_intent(body.message, body.previous_question)
        if re.search(r"задач\w* следующ", question):
            topic = "next-task"
        if topic == "next-task" and intent(body.message) not in (None, "onboarding", "progress"):
            topic = None
        if body.task_id and body.message.casefold().strip(" .?!") in {"с чего начать", "что делать сейчас"}:
            topic = None
        if topic != "request-status":
            with Session(engine) as db:
                items = [task_state(task, user, db) for task in CHECKLIST.values()
                         if task["assigned_role"] == user["role"]]
            focused_id = body.task_id
            if not focused_id and body.previous_question and re.match(
                r"^(?:а\s+)?(?:как (?:это|ее|его)|что (?:конкретно|именно|нужно)|с чего начать)", question
            ):
                previous = checklist_answer(body.previous_question, items, user["role"])
                focused_id = previous.get("task_id") if previous else None
            checklist = checklist_answer(
                body.message, items, user["role"], focused_id, next_step=topic == "next-task" and not focused_id,
            )
            if checklist:
                specialized = intent(body.message) in {
                    "tools-access", "privacy", "git-branch", "review",
                    "test-running", "team-docs", "progress", "planning", "milestones",
                }
                if specialized and not checklist["complete_task"] and "?" in body.message:
                    try:
                        response = answer_question(body.message, user["role"], body.previous_question)
                    except ModelUnavailable as exc:
                        raise HTTPException(503, "Не удалось получить ответ модели. Повторите попытку.") from exc
                    response["task_id"] = checklist.get("task_id")
                    return response
                return checklist
        if topic == "request-status":
            entries = requests(user)["requests"]
            if user["role"] == "mentor":
                count = sum(entry["status"] in {"submitted", "in_review"} for entry in entries)
                answer = f"Заявок на рассмотрении: {count}. Откройте «Заявки стажёров», чтобы согласовать или отклонить заявку."
            elif entries:
                latest = entries[0]
                labels = {"draft": "черновик", "failed": "ошибка отправки", "submitted": "ожидает решения наставника",
                          "in_review": "на рассмотрении", "approved": "согласована", "rejected": "отклонена",
                          "completed": "доступ выдан"}
                number = f" {latest['ticket_id']}" if latest["ticket_id"] else ""
                answer = f"Последняя заявка{number}: {labels[latest['status']]}. {latest['next_step']}"
            else:
                answer = "У вас пока нет заявок на доступ. Откройте «Мои заявки», чтобы подготовить черновик."
        elif topic == "next-task":
            context = tasks(user)
            first = context["first_task"]
            if first and first["state"] == "ready":
                answer = f"Доступ выдан. Можно начать первую рабочую задачу: «{first['title']}»."
            elif first and first["state"] == "waiting":
                answer = "Первая рабочая задача ждёт выдачи доступа. Проверьте статус в «Моих заявках»."
                if first["alternative"]:
                    answer += f" Пока ждёте, откройте в чек-листе «{first['alternative']}»."
            else:
                upcoming = next_checklist_task(context["tasks"])
                answer = (f"Следующий шаг в чек-листе: «{upcoming['title']}». {upcoming['description']}"
                          if upcoming else "В чек-листе сейчас нет незавершённых задач.")
        if topic:
            return {"answer": answer, "sources": [], "mode": "demo", "action": None,
                    "complete_task": None}
        try:
            return answer_question(body.message, user["role"], body.previous_question)
        except ModelUnavailable as exc:
            raise HTTPException(503, "Не удалось получить ответ модели. Повторите попытку.") from exc

    @app.get("/api/requests")
    def requests(user: User):
        with Session(engine) as db:
            assigned = MENTOR_INTERNS.get(user["id"], {})
            scope = (AccessRequest.owner.in_(assigned) & MockTicket.ticket_id.is_not(None)
                     if user["role"] == "mentor" else AccessRequest.owner == user["id"])
            rows = db.execute(select(AccessRequest, MockTicket).outerjoin(MockTicket).where(
                scope
            ).order_by(AccessRequest.created_at.desc()))
            return {"requests": [
                {**serialize_request(row, ticket), **({"intern_name": assigned[row.owner]} if assigned else {})}
                for row, ticket in rows
            ]}

    @app.post("/api/mentor/messages", status_code=201)
    def send_mentor_message(body: Message, user: User):
        require_intern(user)
        with Session(engine) as db:
            message = MentorMessage(id=str(uuid4()), owner=user["id"], message=body.message)
            db.add(message)
            db.commit()
            return {"id": message.id, "status": "sent"}

    @app.get("/api/mentor/messages")
    def mentor_messages(user: User):
        if user["role"] != "mentor":
            raise HTTPException(403, "Доступно наставнику.")
        assigned = MENTOR_INTERNS.get(user["id"], {})
        with Session(engine) as db:
            messages = db.scalars(select(MentorMessage).where(
                MentorMessage.owner.in_(assigned)
            ).order_by(MentorMessage.created_at.desc()))
            return {"messages": [{"id": item.id, "intern_name": assigned[item.owner],
                                  "message": item.message, "created_at": item.created_at}
                                 for item in messages]}

    def authorize_conversation(intern_id, user):
        if user["role"] == "intern" and intern_id == user["id"]:
            return
        if user["role"] == "mentor" and intern_id in MENTOR_INTERNS.get(user["id"], {}):
            return
        raise HTTPException(404, "Диалог не найден.")

    @app.get("/api/mentor/conversations")
    def conversations(user: User):
        if user["role"] != "mentor":
            raise HTTPException(403, "Доступно наставнику.")
        assigned = MENTOR_INTERNS.get(user["id"], {})
        return {"conversations": [{"intern_id": intern_id, "intern_name": name}
                                  for intern_id, name in assigned.items()]}

    @app.get("/api/mentor/conversations/{intern_id}")
    def conversation(intern_id: str, user: User):
        authorize_conversation(intern_id, user)
        with Session(engine) as db:
            incoming = db.scalars(select(MentorMessage).where(MentorMessage.owner == intern_id))
            outgoing = db.scalars(select(MentorReply).where(MentorReply.owner == intern_id))
            messages = [{"id": item.id, "sender": "intern", "message": item.message, "created_at": item.created_at}
                        for item in incoming]
            messages.extend({"id": item.id, "sender": "mentor", "message": item.message, "created_at": item.created_at}
                            for item in outgoing)
            return {"messages": sorted(messages, key=lambda item: (item["created_at"], item["id"]))}

    @app.post("/api/mentor/conversations/{intern_id}", status_code=201)
    def reply_to_intern(intern_id: str, body: Message, user: User):
        authorize_conversation(intern_id, user)
        if user["role"] != "mentor":
            raise HTTPException(403, "Ответ наставника доступен наставнику.")
        with Session(engine) as db:
            reply = MentorReply(id=str(uuid4()), owner=intern_id, mentor_id=user["id"], message=body.message)
            db.add(reply)
            db.commit()
            return {"id": reply.id, "status": "sent"}

    def peer_user(peer_id, user):
        peer = next((candidate for candidate in USERS.values() if candidate["id"] == peer_id), None)
        if (user["role"] != "intern" or not peer or peer["role"] != "intern"
                or peer["id"] == user["id"] or peer["team_id"] != user["team_id"]):
            raise HTTPException(404, "Диалог не найден.")
        return peer

    @app.get("/api/peer/conversations")
    def peer_conversations(user: User):
        require_intern(user)
        return {"conversations": [{"id": candidate["id"], "name": candidate["name"]}
                for candidate in USERS.values() if candidate["role"] == "intern"
                and candidate["team_id"] == user["team_id"] and candidate["id"] != user["id"]]}

    @app.get("/api/chat/contacts")
    def chat_contacts(user: User):
        if user["role"] == "mentor":
            return {"contacts": [{"id": intern_id, "name": name, "kind": "mentor"}
                    for intern_id, name in MENTOR_INTERNS.get(user["id"], {}).items()]}
        mentors = [{"id": candidate["id"], "name": candidate["name"], "kind": "mentor"}
                   for candidate in USERS.values() if candidate["role"] == "mentor"
                   and user["id"] in MENTOR_INTERNS.get(candidate["id"], {})]
        peers = [{"id": candidate["id"], "name": candidate["name"], "kind": "peer"}
                 for candidate in USERS.values() if candidate["role"] == "intern"
                 and candidate["id"] != user["id"] and candidate["team_id"] == user["team_id"]]
        return {"contacts": mentors + peers}

    @app.get("/api/support/messages")
    def support_messages(user: User):
        with Session(engine) as db:
            rows = db.scalars(select(SupportMessage).where(SupportMessage.owner == user["id"])
                              .order_by(SupportMessage.created_at, SupportMessage.id))
            return {"messages": [{"id": row.id, "message": row.message, "created_at": row.created_at}
                                 for row in rows]}

    @app.post("/api/support/messages", status_code=201)
    def send_support_message(body: Message, user: User):
        with Session(engine) as db:
            message = SupportMessage(id=str(uuid4()), owner=user["id"], message=body.message)
            db.add(message)
            db.commit()
            return {"id": message.id, "status": "saved"}

    @app.get("/api/peer/conversations/{peer_id}")
    def peer_conversation(peer_id: str, user: User):
        peer_user(peer_id, user)
        with Session(engine) as db:
            rows = db.scalars(select(PeerMessage).where(
                ((PeerMessage.sender_id == user["id"]) & (PeerMessage.recipient_id == peer_id))
                | ((PeerMessage.sender_id == peer_id) & (PeerMessage.recipient_id == user["id"]))
            ).order_by(PeerMessage.created_at, PeerMessage.id))
            return {"messages": [{"id": item.id, "sender": "me" if item.sender_id == user["id"] else "peer",
                                  "message": item.message, "created_at": item.created_at} for item in rows]}

    @app.post("/api/peer/conversations/{peer_id}", status_code=201)
    def send_peer_message(peer_id: str, body: Message, user: User):
        peer_user(peer_id, user)
        with Session(engine) as db:
            message = PeerMessage(id=str(uuid4()), sender_id=user["id"], recipient_id=peer_id, message=body.message)
            db.add(message)
            db.commit()
            return {"id": message.id, "status": "sent"}

    @app.post("/api/requests", status_code=201)
    def create_draft(
        draft: Draft, user: User,
        idempotency_key: Annotated[str | None, Header(max_length=100)] = None,
    ):
        require_intern(user)
        fingerprint = hashlib.sha256(draft.model_dump_json().encode()).hexdigest()
        key = f"client:{idempotency_key}" if idempotency_key else f"payload:{fingerprint}"
        with Session(engine) as db:
            db.execute(text("BEGIN IMMEDIATE"))
            row = db.scalar(select(AccessRequest).where(
                AccessRequest.owner == user["id"], AccessRequest.idempotency_key == key
            ))
            if row is None:
                row = AccessRequest(id=str(uuid4()), owner=user["id"], idempotency_key=key, **draft.model_dump())
                db.add(row)
                db.flush()
            elif (row.resource, row.reason) != (draft.resource, draft.reason):
                raise HTTPException(409, "Ключ повторной отправки уже использован для другой заявки.")
            payload = serialize_request(row, db.get(MockTicket, row.id))
            db.commit()
        return {"request": payload}

    @app.post("/api/requests/{request_id}/confirm")
    def confirm(request_id: str, confirmation: Confirmation, user: User):
        require_intern(user)
        # Pydantic verifies that confirmed is true before the transaction starts.
        with Session(engine) as db:
            db.execute(text("BEGIN IMMEDIATE"))
            row = db.scalar(select(AccessRequest).where(
                AccessRequest.id == request_id, AccessRequest.owner == user["id"]
            ))
            if row is None:
                raise HTTPException(404, "Заявка не найдена.")
            ticket = db.get(MockTicket, row.id)
            if ticket:
                return {"request": serialize_request(row, ticket)}
            if "[fail-once]" in row.reason and not row.failed_once:
                row.failed_once = True
                row.status = "failed"
                db.commit()
                raise HTTPException(503, "Учебный сервис временно недоступен. Повторите отправку.")
            # The mock service and request commit atomically. The request ID is
            # the integration's idempotency key and MockTicket's primary key.
            ticket = MockTicket(request_id=row.id, ticket_id=f"DEMO-{row.id.upper()}")
            db.add(ticket)
            row.status = "submitted"
            payload = serialize_request(row, ticket)
            db.commit()
        return {"request": payload}

    @app.post("/api/requests/{request_id}/review")
    def review_request(request_id: str, review: Review, user: User):
        if user["role"] != "mentor":
            raise HTTPException(403, "Рассмотрение заявок доступно наставнику.")
        assigned = MENTOR_INTERNS.get(user["id"], {})
        with Session(engine) as db:
            db.execute(text("BEGIN IMMEDIATE"))
            row = db.scalar(select(AccessRequest).where(
                AccessRequest.id == request_id, AccessRequest.owner.in_(assigned)
            ))
            ticket = db.get(MockTicket, request_id)
            if row is None or ticket is None:
                raise HTTPException(404, "Заявка не найдена.")
            if row.status not in {"submitted", "in_review", review.decision}:
                raise HTTPException(409, "Заявка уже рассмотрена.")
            row.status = review.decision
            payload = serialize_request(row, ticket)
            db.commit()
        return {"request": payload}

    @app.post("/api/demo/requests/{request_id}/grant")
    def simulate_grant(request_id: str, confirmation: Confirmation, user: User):
        """Replay a grant from the synthetic service for the user's own ticket."""
        require_intern(user)
        with Session(engine) as db:
            db.execute(text("BEGIN IMMEDIATE"))
            row = db.scalar(select(AccessRequest).where(
                AccessRequest.id == request_id, AccessRequest.owner == user["id"]
            ))
            if row is None:
                raise HTTPException(404, "Заявка не найдена.")
            ticket = db.get(MockTicket, row.id)
            if ticket is None or row.status not in {"approved", "completed"}:
                raise HTTPException(409, "Сначала заявку должен согласовать наставник.")
            row.status = "completed"
            payload = serialize_request(row, ticket)
            db.commit()
        return {"request": payload}

    return app


app = create_app()

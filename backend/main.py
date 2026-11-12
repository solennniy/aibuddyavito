import hashlib
import json
import os
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

from .assistant import ModelUnavailable, answer_question, visible_documents
from .store import AccessRequest, Base, MockTicket, TaskProgress, now


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


class Input(BaseModel):
    model_config = ConfigDict(strict=True, str_strip_whitespace=True, extra="forbid")


class Message(Input):
    message: Annotated[str, Field(min_length=1, max_length=2000)]


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
        "submitted": "Дождитесь ответа учебного сервиса. Доступ ещё не выдан.",
        "in_review": "Дождитесь завершения рассмотрения.",
        "approved": "Дождитесь фактической выдачи доступа.",
        "rejected": "Обратитесь к наставнику.",
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
            return {"tasks": [task_state(task, user, db)
                              for task in CHECKLIST.values() if task["assigned_role"] == user["role"]]}

    @app.patch("/api/tasks/{task_id}")
    def patch_task(task_id: str, change: Progress, user: User):
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
            db.commit()
        return payload

    @app.get("/api/knowledge")
    def knowledge(user: User):
        return {"documents": visible_documents(user["role"])}

    @app.post("/api/chat")
    def chat(body: Message, user: User):
        try:
            return answer_question(body.message, user["role"])
        except ModelUnavailable as exc:
            raise HTTPException(503, "Не удалось получить ответ модели. Повторите попытку.") from exc

    @app.get("/api/requests")
    def requests(user: User):
        with Session(engine) as db:
            rows = db.execute(select(AccessRequest, MockTicket).outerjoin(MockTicket).where(
                AccessRequest.owner == user["id"]
            ).order_by(AccessRequest.created_at.desc()))
            return {"requests": [serialize_request(row, ticket) for row, ticket in rows]}

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

    return app


app = create_app()

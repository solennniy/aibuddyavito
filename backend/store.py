from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def now():
    return datetime.now(timezone.utc).isoformat()


class Base(DeclarativeBase):
    pass


class TaskProgress(Base):
    __tablename__ = "task_progress"

    owner: Mapped[str] = mapped_column(String(40), primary_key=True)
    task_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    status: Mapped[str] = mapped_column(String(16))
    completed_at: Mapped[str | None]


class AccessRequest(Base):
    __tablename__ = "access_requests"
    __table_args__ = (UniqueConstraint("owner", "idempotency_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(40), index=True)
    resource: Mapped[str] = mapped_column(String(40))
    reason: Mapped[str] = mapped_column(String(1000))
    status: Mapped[str] = mapped_column(String(16), default="draft")
    created_at: Mapped[str] = mapped_column(default=now)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    failed_once: Mapped[bool] = mapped_column(default=False)


class MockTicket(Base):
    __tablename__ = "mock_tickets"

    request_id: Mapped[str] = mapped_column(ForeignKey("access_requests.id"), primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String(45), unique=True)


class MentorMessage(Base):
    __tablename__ = "mentor_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(40), index=True)
    message: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[str] = mapped_column(default=now)


class MentorReply(Base):
    __tablename__ = "mentor_replies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(40), index=True)
    mentor_id: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[str] = mapped_column(default=now)


class PeerMessage(Base):
    __tablename__ = "peer_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    sender_id: Mapped[str] = mapped_column(String(40), index=True)
    recipient_id: Mapped[str] = mapped_column(String(40), index=True)
    message: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[str] = mapped_column(default=now)


class SupportMessage(Base):
    __tablename__ = "support_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(40), index=True)
    message: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[str] = mapped_column(default=now)

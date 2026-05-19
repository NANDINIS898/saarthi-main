"""
Pydantic schemas for the Saarthi voice/chat assistant.
"""

from pydantic import BaseModel, Field


class TranscribeResponse(BaseModel):
    text: str
    duration_s: float | None = None
    language: str | None = None


class ChatMessage(BaseModel):
    role: str = Field(..., description="user | assistant")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    # Optional context — if the user is on a loan-flow page, the frontend
    # passes its id so the assistant can reason about their offers, score, etc.
    application_id: int | None = None
    history: list[ChatMessage] = Field(default_factory=list, max_length=20)


class ChatResponse(BaseModel):
    reply: str
    action_hint: str | None = None   # "go_negotiate" | "go_accept" | "go_kyc" | None
    application_id: int | None = None

"""
Saarthi assistant routes — STT + chat.

POST /assistant/transcribe   multipart "file" → {text, duration_s, language}
POST /assistant/chat         {message, application_id?, history?} → {reply, action_hint, application_id}
"""

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.agents.assistant_agent import chat as assistant_chat
from app.agents.assistant_agent import transcribe as stt_transcribe
from app.database.connection import get_db
from app.database.models import User
from app.schemas.assistant import ChatRequest, ChatResponse, TranscribeResponse
from app.utils.deps import get_current_user

router = APIRouter(prefix="/assistant", tags=["Assistant"])


_AUDIO_TYPES = {
    "audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg",
    "audio/x-m4a", "audio/x-wav",
}
_MAX_AUDIO_BYTES = 15 * 1024 * 1024  # 15 MB


@router.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    file: UploadFile = File(..., description="Recorded voice clip (webm / mp4 / wav)"),
    _user: User = Depends(get_current_user),
):
    """Run Groq Whisper on the uploaded audio. Returns the transcript text."""
    raw = (file.content_type or "").split(";", 1)[0].strip().lower()
    if raw not in _AUDIO_TYPES:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            f"Unsupported audio type '{file.content_type}'. Allowed: {sorted(_AUDIO_TYPES)}",
        )
    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty audio.")
    if len(content) > _MAX_AUDIO_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"Audio exceeds {_MAX_AUDIO_BYTES // (1024 * 1024)} MB limit.",
        )
    return stt_transcribe(content, filename=file.filename or "audio.webm")


@router.post("/chat", response_model=ChatResponse)
def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send a message to Saarthi. Optionally scope it to a specific application."""
    return assistant_chat(
        db=db,
        user=user,
        message=payload.message,
        application_id=payload.application_id,
        history=payload.history,
    )

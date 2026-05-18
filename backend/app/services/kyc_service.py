"""
KYC service: session lifecycle + media uploads.

Routes call into here. This layer:
  - creates / fetches KYCSubmission rows
  - validates ownership (a user can only touch their own session)
  - validates content-type + size
  - delegates the actual byte transfer to StorageService
  - writes an AuditEvent row for compliance
"""

from typing import Literal

from fastapi import HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import AuditEvent, KYCSubmission, User
from app.schemas.kyc import UploadResult
from app.services.storage_service import StorageService
from app.utils.logger import logger


# Allow only sensible MIME types — keep the surface small.
_VIDEO_TYPES = {"video/webm", "video/mp4", "video/quicktime", "video/x-matroska"}
_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}

AadhaarSide = Literal["front", "back"]


def _ext_from_content_type(ct: str) -> str:
    return {
        "video/webm": "webm",
        "video/mp4": "mp4",
        "video/quicktime": "mov",
        "video/x-matroska": "mkv",
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
    }.get(ct, "bin")


class KYCService:
    # ──────────────────────────────── Sessions ────────────────────────────────
    @staticmethod
    def start_session(db: Session, user: User) -> KYCSubmission:
        """Create a fresh in_progress KYC session for this user."""
        session = KYCSubmission(user_id=user.id, status="in_progress")
        db.add(session)

        db.add(
            AuditEvent(
                user_id=user.id,
                event_type="kyc_session_start",
                payload={"user_email": user.email},
            )
        )

        db.commit()
        db.refresh(session)
        logger.info(f"KYC session started id={session.id} user_id={user.id}")
        return session

    @staticmethod
    def get_session(db: Session, session_id: int, user: User) -> KYCSubmission:
        session = db.query(KYCSubmission).filter(KYCSubmission.id == session_id).first()
        if not session:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "KYC session not found.")
        if session.user_id != user.id and not user.is_admin:
            # 404 not 403 — don't leak existence of other users' sessions
            raise HTTPException(status.HTTP_404_NOT_FOUND, "KYC session not found.")
        return session

    # ──────────────────────────────── Uploads ─────────────────────────────────
    @staticmethod
    async def upload_video(
        db: Session, session_id: int, user: User, file: UploadFile
    ) -> UploadResult:
        session = KYCService.get_session(db, session_id, user)
        content, content_type = await KYCService._read_and_validate(
            file, allowed=_VIDEO_TYPES, max_bytes=settings.MAX_VIDEO_BYTES, kind="video"
        )

        path = f"sessions/{session.id}/video.{_ext_from_content_type(content_type)}"
        full_path = await StorageService.upload(path, content, content_type)
        signed = await StorageService.create_signed_url(path)

        session.video_url = full_path
        db.add(
            AuditEvent(
                user_id=user.id,
                event_type="kyc_video_uploaded",
                payload={"session_id": session.id, "size": len(content)},
            )
        )
        db.commit()

        return UploadResult(
            session_id=session.id,
            storage_path=full_path,
            signed_url=signed,
            size_bytes=len(content),
            content_type=content_type,
            field="video",
        )

    @staticmethod
    async def upload_aadhaar(
        db: Session, session_id: int, user: User, side: AadhaarSide, file: UploadFile
    ) -> UploadResult:
        if side not in ("front", "back"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "side must be 'front' or 'back'.")

        session = KYCService.get_session(db, session_id, user)
        content, content_type = await KYCService._read_and_validate(
            file, allowed=_IMAGE_TYPES, max_bytes=settings.MAX_IMAGE_BYTES, kind="image"
        )

        path = f"sessions/{session.id}/aadhaar_{side}.{_ext_from_content_type(content_type)}"
        full_path = await StorageService.upload(path, content, content_type)
        signed = await StorageService.create_signed_url(path)

        if side == "front":
            session.aadhaar_front_url = full_path
        else:
            session.aadhaar_back_url = full_path

        db.add(
            AuditEvent(
                user_id=user.id,
                event_type=f"kyc_aadhaar_{side}_uploaded",
                payload={"session_id": session.id, "size": len(content)},
            )
        )
        db.commit()

        return UploadResult(
            session_id=session.id,
            storage_path=full_path,
            signed_url=signed,
            size_bytes=len(content),
            content_type=content_type,
            field=f"aadhaar_{side}",
        )

    # ──────────────────────────────── Helpers ─────────────────────────────────
    @staticmethod
    async def _read_and_validate(
        file: UploadFile, *, allowed: set[str], max_bytes: int, kind: str
    ) -> tuple[bytes, str]:
        # MediaRecorder often emits MIMEs like "video/webm;codecs=vp9".
        # Strip the codec parameter before comparing against the allowed set.
        raw = (file.content_type or "").strip()
        base_type = raw.split(";", 1)[0].strip().lower()
        if base_type not in allowed:
            raise HTTPException(
                status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                f"Unsupported {kind} type '{raw}'. Allowed: {sorted(allowed)}",
            )
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file.")
        if len(content) > max_bytes:
            raise HTTPException(
                status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                f"{kind.capitalize()} exceeds {max_bytes // (1024 * 1024)} MB limit.",
            )
        return content, base_type

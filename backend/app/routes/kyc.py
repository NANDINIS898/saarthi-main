"""
KYC routes.

POST /kyc/session/start                       -> create a session
GET  /kyc/session/{id}                        -> read session state
POST /kyc/session/{id}/upload-video           -> multipart upload (video/webm, mp4, …)
POST /kyc/session/{id}/upload-aadhaar?side=…  -> multipart upload (image/jpeg, png, webp)

All routes require a Bearer token. A user can only access their own sessions
(admins can access any).
"""

from fastapi import APIRouter, Depends, File, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import User
from app.schemas.kyc import KYCSessionResponse, UploadResult
from app.services.kyc_pipeline_service import KYCPipelineService
from app.services.kyc_service import AadhaarSide, KYCService
from app.utils.deps import get_current_user

router = APIRouter(prefix="/kyc", tags=["KYC"])


@router.post(
    "/session/start",
    response_model=KYCSessionResponse,
    status_code=status.HTTP_201_CREATED,
)
def start_session(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Begin a new KYC session for the authenticated user."""
    return KYCService.start_session(db, user)


@router.get("/session/{session_id}", response_model=KYCSessionResponse)
def get_session(
    session_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Fetch the current state of a KYC session."""
    return KYCService.get_session(db, session_id, user)


@router.post(
    "/session/{session_id}/upload-video",
    response_model=UploadResult,
)
async def upload_video(
    session_id: int,
    file: UploadFile = File(..., description="Onboarding video (webm / mp4 / mov / mkv)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload the onboarding video for this session."""
    return await KYCService.upload_video(db, session_id, user, file)


@router.post(
    "/session/{session_id}/upload-aadhaar",
    response_model=UploadResult,
)
async def upload_aadhaar(
    session_id: int,
    side: AadhaarSide = Query(..., description="Which side of the Aadhaar card: front or back"),
    file: UploadFile = File(..., description="Aadhaar image (jpg / png / webp)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload one side of the Aadhaar card for this session."""
    return await KYCService.upload_aadhaar(db, session_id, user, side, file)


@router.post(
    "/session/{session_id}/verify",
    response_model=KYCSessionResponse,
)
async def verify_session(
    session_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Run the full KYC pipeline (OCR + face match + liveness) on the uploaded
    media for this session. Updates the session row with scores and a final
    `approved` / `rejected` status.

    Synchronous for now — expect ~5–15 s per call depending on video length.
    """
    return await KYCPipelineService.run(db, session_id, user)

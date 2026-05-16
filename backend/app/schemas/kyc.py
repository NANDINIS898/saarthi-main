"""
Pydantic schemas for the KYC flow.

The frontend talks to /kyc/* using these shapes.
"""

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field


class KYCSessionResponse(BaseModel):
    """Returned by POST /kyc/session/start and GET /kyc/session/{id}."""
    id: int
    user_id: int
    status: str                              # in_progress / processing / approved / rejected
    video_url: Optional[str] = None
    aadhaar_front_url: Optional[str] = None
    aadhaar_back_url: Optional[str] = None
    face_match_score: Optional[float] = None
    liveness_score: Optional[float] = None
    ocr_extracted: Optional[dict[str, Any]] = None
    failure_reason: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class UploadResult(BaseModel):
    """Returned after a successful media upload."""
    session_id: int
    storage_path: str                        # "<bucket>/sessions/<id>/<file>"
    signed_url: str                          # short-lived URL the frontend can preview
    size_bytes: int
    content_type: str
    field: str = Field(..., description="which slot got filled: video / aadhaar_front / aadhaar_back")

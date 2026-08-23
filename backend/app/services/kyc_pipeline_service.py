"""
KYC verification orchestrator.

Given a KYC session id, this service:
  1. Downloads the uploaded video and Aadhaar front image from Supabase Storage.
  2. Runs Aadhaar OCR (Groq Vision).
  3. Pulls the middle frame of the video and runs face match against the Aadhaar photo.
  4. Runs MediaPipe liveness on the full video.
  5. Decides approved / rejected based on per-signal thresholds.
  6. Writes results back to the KYCSubmission row + an AuditEvent.
  7. Returns the updated session.

The CV/LLM work is CPU-bound, so we hand it off to a thread executor
otherwise it would block the FastAPI event loop.
"""

import asyncio
import re
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.database.models import AuditEvent, KYCSubmission, User
from app.ml.kyc.face_match import compare_faces
from app.ml.kyc.liveness import check_liveness, extract_middle_frame
from app.ml.kyc.ocr import extract_aadhaar_fields

from app.services.storage_service import StorageService
from app.utils.logger import logger

# ─── thresholds (tune later as we collect data) ──────────────────────────────── 
FACE_MATCH_MIN     = 0.70   # match_score below this → reject 
LIVENESS_MIN       = 0.40   # liveness_score below this → reject 
OCR_REQUIRED_FIELDS = ("full_name", "dob") 
 
 
class KYCPipelineService: 
    @staticmethod 
    async def run(db: Session, session_id: int, user: User) -> KYCSubmission: 
        session = _load_session(db, session_id, user) 
        _require_uploaded_media(session) 
 
        # ── 1. Download media (await, network-bound) ────────────────────────── 
        logger.info(f"[KYC pipeline] session={session.id} downloading media") 
        video_bytes = await StorageService.download(session.video_url) 
        aadhaar_front_bytes = await StorageService.download(session.aadhaar_front_url) 
 
        # Mark as processing so concurrent clients know 
        session.status = "processing" 
        session.failure_reason = None 
        db.commit() 
 
        # ── 2-4. CV / LLM work (CPU-bound, run in worker thread) ────────────── 
        try: 
            ocr_data, face_data, liveness_data = await asyncio.to_thread( 
                _run_cv_stack, video_bytes, aadhaar_front_bytes 
            ) 
        except Exception as e: 
            logger.exception(f"[KYC pipeline] CV stack failed: {e}") 
            session.status = "rejected" 
            session.failure_reason = f"Pipeline error: {e}" 
            db.add(AuditEvent( 
                user_id=user.id, application_id=None, 
                event_type="kyc_pipeline_error", 
                payload={"session_id": session.id, "error": str(e)[:500]}, 
            )) 
            db.commit() 
            db.refresh(session) 
            return session 
 
        # ── 5. Decide ───────────────────────────────────────────────────────── 
        decision, reason = _decide(ocr_data, face_data, liveness_data, user) 
 
        # ── 6. Persist ──────────────────────────────────────────────────────── 
        session.ocr_extracted = ocr_data 
        session.face_match_score = float(face_data.get("match_score") or 0.0) 
        session.liveness_score = float(liveness_data.get("liveness_score") or 0.0) 
        session.status = decision 
        session.failure_reason = reason if decision == "rejected" else None 
 
        # Bubble verified flag onto the user when we approve 
        if decision == "approved": 
            user.kyc_status = "approved" 
            user.is_verified = True 
        elif decision == "rejected": 
            user.kyc_status = "rejected" 
 
        db.add(AuditEvent( 
            user_id=user.id, 
            event_type=f"kyc_{decision}", 
            payload={ 
                "session_id": session.id, 
                "face_match_score": session.face_match_score, 
                "liveness_score": session.liveness_score, 
                "ocr_readable": ocr_data.get("is_readable"), 
                "reason": reason, 
            }, 
        )) 
        db.commit() 
        db.refresh(session) 
 
        logger.info( 
            f"[KYC pipeline] session={session.id} → {decision} " 
            f"(face={session.face_match_score:.2f}, live={session.liveness_score:.2f})" 
        ) 
        return session 
 
 
# ────────────────────────────────── helpers ──────────────────────────────────── 
def _load_session(db: Session, session_id: int, user: User) -> KYCSubmission: 
    session = db.query(KYCSubmission).filter(KYCSubmission.id == session_id).first() 
    if not session: 
        raise HTTPException(status.HTTP_404_NOT_FOUND, "KYC session not found.") 
    if session.user_id != user.id and not user.is_admin: 
        raise HTTPException(status.HTTP_404_NOT_FOUND, "KYC session not found.") 
    return session 
 
 
def _require_uploaded_media(session: KYCSubmission) -> None: 
    missing = [] 
    if not session.video_url: 
        missing.append("video") 
    if not session.aadhaar_front_url: 
        missing.append("aadhaar_front") 
    if missing: 
        raise HTTPException( 
            status.HTTP_400_BAD_REQUEST, 
            f"Cannot verify yet — missing uploads: {', '.join(missing)}", 
        ) 
 
 
def _run_cv_stack(video_bytes: bytes, aadhaar_front_bytes: bytes) -> tuple[dict, dict, dict]: 
    """Synchronous bundle of CV/LLM work — runs in a worker thread.""" 
    # OCR on the front of the Aadhaar 
    ocr_data = extract_aadhaar_fields(aadhaar_front_bytes, mime="image/jpeg") 
 
    # Pull middle frame from video for face comparison 
    live_frame = extract_middle_frame(video_bytes) 
    if live_frame is None: 
        face_data = { 
            "same_person": False, "confidence": 0.0, "match_score": 0.0, 
            "rationale": "Could not extract a frame from the video.", 
        } 
    else: 
        face_data = compare_faces(live_frame, aadhaar_front_bytes) 
 
    liveness_data = check_liveness(video_bytes) 
 
    return ocr_data, face_data, liveness_data 
 
 
def _decide( 
    ocr: dict[str, Any], 
    face: dict[str, Any], 
    live: dict[str, Any], 
    user: User, 
) -> tuple[str, str]: 
    """Return (decision, reason). Decision is 'approved' or 'rejected'.""" 
    reasons = [] 
 
    if not ocr.get("is_readable"): 
        reasons.append("Aadhaar not readable") 
    for field in OCR_REQUIRED_FIELDS: 
        if not ocr.get(field): 
            reasons.append(f"missing OCR field: {field}") 
 
    # NEW: the OCR name on the card must match the registered account name. 
    # Without this, a user can pass KYC by showing someone else's card whose 
    # owner happens to be the live person on camera. 
    ocr_name = (ocr.get("full_name") or "").strip() 
    if ocr_name and not _names_match(user.full_name, ocr_name): 
        reasons.append( 
            f"name on Aadhaar ('{ocr_name}') doesn't match account name " 
            f"('{user.full_name}')" 
        ) 
 
    match_score = float(face.get("match_score") or 0.0) 
    if not face.get("same_person") or match_score < FACE_MATCH_MIN: 
        reasons.append(f"face match too low ({match_score:.2f} < {FACE_MATCH_MIN})") 
 
    liveness_score = float(live.get("liveness_score") or 0.0) 
    if not live.get("is_live") or liveness_score < LIVENESS_MIN: 
        reasons.append(f"liveness too low ({liveness_score:.2f} < {LIVENESS_MIN}): {live.get('reason')}") 
 
    if reasons: 
        return "rejected", "; ".join(reasons) 
    return "approved", "all checks passed" 
 
 
def _names_match(registered: str, on_card: str) -> bool: 
    """ 
    Fuzzy comparison good enough to catch impersonation while tolerating 
    Indian-name realities: middle names, initials, title prefixes, case. 
 
    Rule: both the FIRST and LAST tokens of the registered name must appear 
    somewhere in the tokens of the card name (case-insensitive, punctuation 
    stripped). Single-name users degenerate to "that single token must appear". 
    """ 
    def _tokens(s: str) -> list[str]: 
        cleaned = re.sub(r"[^a-z\s]", " ", (s or "").lower()) 
        # Drop common Indian honorifics + initials that add no identity info. 
        skip = {"mr", "mrs", "ms", "miss", "shri", "sri", "smt", "kumari", "kumar", "sh"} 
        return [t for t in cleaned.split() if len(t) >= 2 and t not in skip] 
 
    reg = _tokens(registered) 
    card = _tokens(on_card) 
    if not reg or not card: 
        return False 
 
    if len(reg) == 1: 
        return reg[0] in card 
    return reg[0] in card and reg[-1] in card 

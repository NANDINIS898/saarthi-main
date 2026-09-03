"""
LoanApplication routes — the heart of the underwriting + decision flow.

Endpoints:
  POST   /applications                                  create
  GET    /applications                                  list mine
  GET    /applications/{id}                             read
  POST   /applications/{id}/underwrite                  run XGBoost + SHAP
  GET    /applications/{id}/risk                        latest RiskAssessment
  POST   /applications/{id}/offers/generate             generate 3 offers
  GET    /applications/{id}/offers                      list offers
  POST   /applications/{id}/negotiate                   Groq LLM negotiation
  POST   /applications/{id}/offers/{offer_id}/accept    accept + sanction
  GET    /applications/{id}/sanction                    fetch sanction letter (with signed PDF URL)
"""

from typing import List

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy.orm import Session

from app.agents.decision_engine import DecisionEngine
from app.agents.negotiation_agent import NegotiationAgent
from app.agents.sanction_writer import SanctionWriter
from app.agents.underwriting_agent import UnderwritingAgent
from app.database.connection import get_db
from app.database.models import IdempotencyKey, LoanOffer, RiskAssessment, SanctionLetter, User
from app.schemas.loan import (
    ApplicationSummary, LoanApplicationCreate, LoanApplicationOut, LoanOfferOut,
    NegotiationRequest, NegotiationResponse, RiskAssessmentOut,
    SanctionLetterOut,
)
from app.services.loan_service import LoanService
from app.services.storage_service import StorageService
from app.utils.deps import get_current_user

router = APIRouter(prefix="/applications", tags=["Applications"])


# ─── Create / read ────────────────────────────────────────────────────────────
@router.post("", response_model=LoanApplicationOut, status_code=status.HTTP_201_CREATED)
def create_application(
    payload: LoanApplicationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return LoanService.create(db, user, payload)


@router.get("", response_model=List[LoanApplicationOut])
def list_applications(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return LoanService.list_for_user(db, user)


@router.get("/{application_id}", response_model=LoanApplicationOut)
def get_application(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    return LoanService.get(db, application_id, user)


@router.get("/{application_id}/summary", response_model=ApplicationSummary)
async def application_summary(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Aggregated view of an application: risk + offers + sanction + lifecycle
    flags. Used by the Applications list and the resume-loan-flow screen.
    """
    app = LoanService.get(db, application_id, user)

    risk = (
        db.query(RiskAssessment)
        .filter(RiskAssessment.application_id == app.id)
        .order_by(RiskAssessment.id.desc())
        .first()
    )
    offers = (
        db.query(LoanOffer)
        .filter(LoanOffer.application_id == app.id)
        .order_by(LoanOffer.id.asc())
        .all()
    )
    accepted = next((o for o in offers if o.accepted), None)
    sanction_row = (
        db.query(SanctionLetter)
        .filter(SanctionLetter.application_id == app.id)
        .first()
    )
    sanction_out = await _letter_with_signed_url(sanction_row) if sanction_row else None

    return ApplicationSummary(
        application=app,                      # type: ignore[arg-type]
        risk=risk,                            # type: ignore[arg-type]
        offers=offers,                        # type: ignore[arg-type]
        accepted_offer=accepted,              # type: ignore[arg-type]
        sanction=sanction_out,
        kyc_done=(user.kyc_status == "approved"),
        underwriting_done=risk is not None,
        offers_generated=bool(offers),
        offer_accepted=accepted is not None,
        sanction_issued=sanction_row is not None,
        admin_approved=bool(sanction_row and sanction_row.status == "approved"),
    )


# ─── Underwriting ─────────────────────────────────────────────────────────────
@router.post("/{application_id}/underwrite", response_model=RiskAssessmentOut)
def underwrite(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Run the XGBoost risk model + SHAP and persist a RiskAssessment."""
    app = LoanService.get(db, application_id, user)
    return UnderwritingAgent.assess(db, app, user)


@router.get("/{application_id}/risk", response_model=RiskAssessmentOut)
def latest_risk(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    app = LoanService.get(db, application_id, user)
    row = (
        db.query(RiskAssessment)
        .filter(RiskAssessment.application_id == app.id)
        .order_by(RiskAssessment.id.desc())
        .first()
    )
    if not row:
        from fastapi import HTTPException
        raise HTTPException(404, "No risk assessment yet — run /underwrite first.")
    return row


# ─── Offers ───────────────────────────────────────────────────────────────────
@router.post("/{application_id}/offers/generate", response_model=List[LoanOfferOut])
def generate_offers(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    app = LoanService.get(db, application_id, user)
    return DecisionEngine.generate_offers(db, app, user)


@router.get("/{application_id}/offers", response_model=List[LoanOfferOut])
def list_offers(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    app = LoanService.get(db, application_id, user)
    return DecisionEngine.get_offers(db, app.id)


# ─── Negotiation ──────────────────────────────────────────────────────────────
@router.post("/{application_id}/negotiate", response_model=NegotiationResponse)
def negotiate(
    application_id: int,
    payload: NegotiationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """One round of negotiation. Returns a fresh counter-offer + the agent message."""
    app = LoanService.get(db, application_id, user)
    return NegotiationAgent.negotiate(db, app, payload.message)


# ─── Accept + sanction ────────────────────────────────────────────────────────
@router.post(
    "/{application_id}/offers/{offer_id}/accept",
    response_model=SanctionLetterOut,
)
async def accept_offer(
    application_id: int,
    offer_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key",
    ),
):
    """Accept this offer and generate a sanction letter PDF with idempotency protection."""

    # Import existing Saarthi logger locally so no other part of this file changes.
    from app.utils.logger import logger

    # ---------------------------------------------------------
    # 1. Require idempotency key
    # ---------------------------------------------------------
    if not idempotency_key:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=400,
            detail="Idempotency-Key header is required.",
        )

    logger.info(
        f"[IDEMPOTENCY] START "
        f"key={idempotency_key} "
        f"user={user.id} "
        f"app={application_id} "
        f"offer={offer_id}"
    )

    # ---------------------------------------------------------
    # 2. Check whether this request was already processed
    # ---------------------------------------------------------
    existing = (
        db.query(IdempotencyKey)
        .filter(
            IdempotencyKey.key == idempotency_key,
            IdempotencyKey.user_id == user.id,
        )
        .first()
    )

    if existing:
        logger.info(
            f"[IDEMPOTENCY] DUPLICATE "
            f"key={idempotency_key} "
            f"→ returning cached result"
        )

        return existing.response

    logger.info(
        f"[IDEMPOTENCY] NEW REQUEST "
        f"key={idempotency_key} "
        f"→ executing operation"
    )

    # ---------------------------------------------------------
    # 3. Normal Saarthi acceptance flow
    # ---------------------------------------------------------
    app = LoanService.get(db, application_id, user)

    offer = DecisionEngine.accept_offer(
        db,
        app,
        offer_id,
    )

    logger.info(
        f"[IDEMPOTENCY] OPERATION EXECUTED "
        f"key={idempotency_key} "
        f"offer={offer.id}"
    )

    # ---------------------------------------------------------
    # 4. Generate sanction letter
    # ---------------------------------------------------------
    letter = await SanctionWriter.issue(
        db,
        app,
        offer,
        user,
    )

    result = await _letter_with_signed_url(letter)

    # ---------------------------------------------------------
    # 5. Store response against idempotency key
    # ---------------------------------------------------------
    record = IdempotencyKey(
        key=idempotency_key,
        user_id=user.id,
        endpoint=(
            f"/applications/{application_id}"
            f"/offers/{offer_id}/accept"
        ),
        response={
            "id": result.id,
            "application_id": result.application_id,
            "ref_no": result.ref_no,
            "pdf_url": result.pdf_url,
            "signed_url": result.signed_url,
            "status": result.status,
            "created_at": result.created_at.isoformat(),
        },
    )

    db.add(record)
    db.commit()

    logger.info(
        f"[IDEMPOTENCY] STORED "
        f"key={idempotency_key} "
        f"→ future duplicates will reuse this result"
    )

    return result



@router.get("/{application_id}/sanction", response_model=SanctionLetterOut)
async def get_sanction(
    application_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    app = LoanService.get(db, application_id, user)
    letter = (
        db.query(SanctionLetter)
        .filter(SanctionLetter.application_id == app.id)
        .first()
    )
    if not letter:
        from fastapi import HTTPException
        raise HTTPException(404, "No sanction letter yet — accept an offer first.")
    return await _letter_with_signed_url(letter)


async def _letter_with_signed_url(letter: SanctionLetter) -> SanctionLetterOut:
    """Mint a fresh signed URL for the PDF (private bucket)."""
    signed = None
    if letter.pdf_url:
        try:
            signed = await StorageService.create_signed_url(letter.pdf_url, expires_in_seconds=3600)
        except Exception:
            signed = None  # don't 500 the whole response if storage hiccups
    return SanctionLetterOut(
        id=letter.id,
        application_id=letter.application_id,
        ref_no=letter.ref_no,
        pdf_url=letter.pdf_url,
        signed_url=signed,
        status=letter.status,
        created_at=letter.created_at,
    )

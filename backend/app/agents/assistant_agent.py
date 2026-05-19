"""
Saarthi conversational assistant.

This is the user-facing chatbot you can talk to from anywhere in the app.
Two responsibilities:

  1. Transcribe audio (browser -> bytes -> Groq Whisper -> text).
  2. Answer questions in context of the user's profile and (optionally) a
     specific loan application: status, risk score, current offer, EMI,
     SHAP drivers, where to click next.

This is NOT the negotiation agent — negotiation is a separate route that
actually mutates state. The assistant only *guides* and explains; it suggests
when to switch to /loan/{id} to take action.
"""

from __future__ import annotations

import io
from typing import Any

from fastapi import HTTPException, status
from groq import Groq
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import (
    KYCSubmission, LoanApplication, LoanOffer, RiskAssessment,
    SanctionLetter, User,
)
from app.schemas.assistant import ChatMessage
from app.utils.logger import logger


CHAT_MODEL = "llama-3.3-70b-versatile"
STT_MODEL  = "whisper-large-v3-turbo"


def _client() -> Groq:
    if not settings.GROQ_API_KEY:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "GROQ_API_KEY is not configured.",
        )
    return Groq(api_key=settings.GROQ_API_KEY)


# ─────────────────────────────────────────────────────────────────────────────
# Speech-to-text
# ─────────────────────────────────────────────────────────────────────────────
def transcribe(audio_bytes: bytes, filename: str = "audio.webm") -> dict[str, Any]:
    """Run Groq Whisper on the given audio bytes. Returns dict with text + meta."""
    client = _client()
    # Groq SDK expects a file-like object with .name
    bio = io.BytesIO(audio_bytes)
    bio.name = filename
    try:
        resp = client.audio.transcriptions.create(
            file=bio,
            model=STT_MODEL,
            response_format="verbose_json",
            temperature=0.0,
        )
    except Exception as e:
        logger.exception("STT failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Transcription failed: {e}")

    # Groq returns either a dict-like or pydantic-like object depending on SDK version.
    data = resp if isinstance(resp, dict) else getattr(resp, "model_dump", lambda: vars(resp))()
    return {
        "text":       (data.get("text") or "").strip(),
        "duration_s": data.get("duration"),
        "language":   data.get("language"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Chat
# ─────────────────────────────────────────────────────────────────────────────
_SYSTEM = """You are Saarthi, an AI loan assistant for an Indian micro-lender.
You speak plainly and warmly. Keep replies under 80 words unless the user asks
for detail. Refer to the user by first name when natural.

You can explain:
  - the user's KYC status and what to do next if it's pending/rejected
  - their credit score and what drove it (SHAP top drivers)
  - their current loan offer (amount, rate, tenure, EMI) and how it compares
  - what "negotiate" / "accept" / "sanction letter" mean and how to do them
  - their negotiation history if any

You do NOT take actions yourself. You guide the user. If they say "accept it"
or "lower the EMI to 9000", tell them clearly: "Go to your loan page and click
Accept" or "Go to the negotiation chat on the loan page and type your message."

If the user asks something unrelated to loans, politely steer back."""


def build_context(
    db: Session, user: User, application_id: int | None
) -> tuple[str, str | None]:
    """
    Return (context_block, action_hint).

    context_block goes into the system prompt as factual grounding the model
    can reference. action_hint is a short tag the frontend can act on.
    """
    parts = [
        f"User: {user.full_name} <{user.email}>",
        f"Account KYC status: {user.kyc_status}",
        f"Account verified: {user.is_verified}",
    ]

    if user.kyc_status != "approved":
        latest_kyc = (
            db.query(KYCSubmission)
            .filter(KYCSubmission.user_id == user.id)
            .order_by(KYCSubmission.id.desc())
            .first()
        )
        if latest_kyc:
            parts.append(
                f"Latest KYC: status={latest_kyc.status}, "
                f"face_match={latest_kyc.face_match_score}, "
                f"liveness={latest_kyc.liveness_score}, "
                f"reason={latest_kyc.failure_reason or 'n/a'}"
            )
        return "\n".join(parts), "go_kyc"

    action_hint: str | None = None
    if application_id is not None:
        app = (
            db.query(LoanApplication)
            .filter(LoanApplication.id == application_id, LoanApplication.user_id == user.id)
            .first()
        )
        if app:
            parts.append(
                f"Current application #{app.id}: "
                f"asked ₹{app.loan_amount} for '{app.loan_purpose}', "
                f"income ₹{app.monthly_income}/mo, "
                f"tenure {app.tenure_preference_months}mo, status={app.status}"
            )
            risk = (
                db.query(RiskAssessment)
                .filter(RiskAssessment.application_id == app.id)
                .order_by(RiskAssessment.id.desc())
                .first()
            )
            if risk:
                top_drivers = []
                if risk.shap_values:
                    sorted_shap = sorted(
                        risk.shap_values.items(), key=lambda kv: abs(kv[1]), reverse=True
                    )[:4]
                    top_drivers = [f"{k} ({v:+.2f})" for k, v in sorted_shap]
                parts.append(
                    f"ML risk → credit_score={risk.risk_score:.0f}, decision={risk.decision}, "
                    f"top drivers: {', '.join(top_drivers) or 'n/a'}"
                )
            offers = (
                db.query(LoanOffer)
                .filter(LoanOffer.application_id == app.id)
                .order_by(LoanOffer.id.asc())
                .all()
            )
            accepted = next((o for o in offers if o.accepted), None)
            if offers and not accepted:
                best = next((o for o in offers if o.is_recommended), offers[0])
                parts.append(
                    f"Best current offer: ₹{best.amount:,.0f} at "
                    f"{best.interest_rate}% p.a. for {best.tenure_months} months, "
                    f"EMI ₹{best.emi:,.0f}. Negotiation round: {best.negotiation_round}"
                )
                action_hint = "go_negotiate"
            elif accepted:
                parts.append(
                    f"Offer accepted: ₹{accepted.amount:,.0f} @ {accepted.interest_rate}%, "
                    f"EMI ₹{accepted.emi:,.0f} × {accepted.tenure_months}mo"
                )
                sanction = (
                    db.query(SanctionLetter)
                    .filter(SanctionLetter.application_id == app.id)
                    .first()
                )
                if sanction:
                    parts.append(f"Sanction letter {sanction.ref_no} — {sanction.status}")

    return "\n".join(parts), action_hint


def chat(
    db: Session,
    user: User,
    message: str,
    application_id: int | None,
    history: list[ChatMessage],
) -> dict[str, Any]:
    context_block, action_hint = build_context(db, user, application_id)

    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "system", "content": f"Context for this turn:\n{context_block}"},
    ]
    for m in history[-12:]:  # keep prompt small
        if m.role in ("user", "assistant"):
            messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": message})

    client = _client()
    try:
        resp = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=messages,
            temperature=0.4,
            max_tokens=400,
        )
    except Exception as e:
        logger.exception("Assistant chat failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Chat failed: {e}")

    reply = (resp.choices[0].message.content or "").strip()
    return {
        "reply": reply,
        "action_hint": action_hint,
        "application_id": application_id,
    }

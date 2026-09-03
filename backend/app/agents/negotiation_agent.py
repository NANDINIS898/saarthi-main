"""
Negotiation Agent.

The user chats with this agent to push the offer around. We give the Groq LLM:
  - The current best offer
  - The user's risk-tier hard constraints (from DecisionEngine.constraints)
  - The user's latest message

The model MUST return a strict JSON object — never prose alone — describing:
  - A counter-offer (amount / rate / tenure)
  - The EMI it implies (we recompute server-side to prevent drift)
  - A short user-facing message

We then validate the proposal against constraints, persist a new LoanOffer
row (negotiation_round += 1), and return it.
"""

from __future__ import annotations

import json
import re
import time
from typing import Any

from fastapi import HTTPException, status
from groq import Groq
from sqlalchemy.orm import Session

from app.agents.decision_engine import DecisionEngine
from app.agents.emi import calculate, emi_to_income_ratio
from app.config import settings
from app.database.models import AgentDecision, LoanApplication, LoanOffer
from app.utils.logger import logger


NEGOTIATION_MODEL = "openai/gpt-oss-120b"


_SYSTEM = """You are Saarthi's loan negotiation agent. You negotiate with a borrower
who wants a different amount, interest rate, or tenure. You MUST stay inside the
business constraints the engine gives you — never exceed rate_ceiling, never go
below rate_floor, never exceed max_tenure_months, never let EMI/income exceed max_dti.

You are helpful but firm. If the borrower asks for something outside policy,
counter with the closest legal option and explain why.

CRITICAL FORMATTING RULE for message_to_user:
  - DO NOT mention specific rupee EMI / amount / interest-rate / tenure NUMBERS.
  - The UI displays those values in a structured card next to your message.
  - Talk about the *change* you made ("I extended the tenure", "I dropped the
    rate to the floor", "I trimmed the principal slightly") — NOT the figures.
  - Quoting numbers risks them being out of sync with the recomputed offer.

Reply with ONLY a JSON object. Never include prose outside the JSON."""


_USER_TEMPLATE = """## Borrower message
"{user_message}"

## Current best offer
{current_offer}

## Business constraints (HARD limits — do not cross)
{constraints}

## Negotiation history (most recent last)
{history}

## Your task
First decide if the borrower is *accepting* the current offer (phrases like
"yes do that", "accept", "I'll take it", "go ahead", "sounds good", "okay
let's do it", "perfect", "sign me up"). If they are, set
user_accepting=true and STILL return the current offer numbers unchanged.

Otherwise propose ONE counter-offer that respects every constraint.

Return strictly this JSON:

{{
  "amount":          number,
  "interest_rate":   number,
  "tenure_months":   integer,
  "message_to_user": "short 1-3 sentence explanation, friendly and direct",
  "concession":      "amount | rate | tenure | none — which lever you moved most",
  "user_accepting":  boolean   // true if the borrower wants to accept the current offer
}}

Rules:
- interest_rate must be between {rate_floor} and {rate_ceiling}
- tenure_months must be between 12 and {max_tenure_months}
- amount must be ≤ asked_amount × amount_factor ({max_amount})
- EMI/monthly_income must be ≤ {max_dti}
- If user_accepting is true, your message_to_user should confirm the acceptance.
"""


# Patterns the LLM tends to use even when told not to:
#   ₹9,441 · Rs 9441 · INR 9,441 · 9441 rupees · 9,441/month · EMI of 9441
_RUPEE_PATTERNS = [
    re.compile(r"(?:₹|Rs\.?|INR)\s*[\d,]+(?:\.\d+)?", re.IGNORECASE),
    re.compile(r"\b\d[\d,]{2,}(?:\.\d+)?\s*(?:rupees?|/\s*month|per\s*month)\b", re.IGNORECASE),
    re.compile(r"\bEMI\s+(?:of|to|at|now|will\s+be)\s*[\d,]+(?:\.\d+)?\b", re.IGNORECASE),
]


def _strip_specific_figures(text: str) -> str:
    """Remove rupee-figure phrases so chat text can't disagree with the offer card."""
    if not text:
        return text
    cleaned = text
    for pat in _RUPEE_PATTERNS:
        cleaned = pat.sub("the new figure", cleaned)
    # Collapse double spaces from substitutions.
    return re.sub(r"\s{2,}", " ", cleaned).strip()


def _client() -> Groq:
    if not settings.GROQ_API_KEY:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "GROQ_API_KEY is not configured.",
        )
    return Groq(api_key=settings.GROQ_API_KEY)
MAX_NEGOTIATION_ROUNDS = 5

class NegotiationAgent:
    @staticmethod
    def negotiate(db: Session, application: LoanApplication, user_message: str) -> dict[str, Any]:
        constraints = DecisionEngine.constraints(db, application)
        current = _current_best_offer(db, application.id)
        if not current:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "No offers yet — generate offers before negotiating.")

        current_round = current.negotiation_round or 0
        if current_round >= MAX_NEGOTIATION_ROUNDS:
            db.add(AgentDecision(
                application_id=application.id,
                agent_name="negotiation",
                decision="saturation_reached",
                reasoning=f"Round {current_round} — negotiation cap hit, returning final offer.",
                llm_trace={"user_message": user_message, "round": current_round},
            ))
            db.commit()
            return {
                "offer": current,
                "agent_message": "This is the best offer I'm able to give you — we've reached the limit on how far this can be negotiated. You're welcome to accept it or apply again later if your situation changes.",
                "concession": "none",
                "round": current_round,
                "dti": emi_to_income_ratio(current.emi, constraints["monthly_income"]),
                "user_accepting": False,
            }
    
    
        """
        One round of negotiation.

        Returns:
            {
              "offer": LoanOffer row dict,
              "agent_message": str,
              "concession": "amount" | "rate" | "tenure" | "none",
              "round": int,
            }
        """
        constraints = DecisionEngine.constraints(db, application)
        current = _current_best_offer(db, application.id)
        if not current:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "No offers yet — generate offers before negotiating.",
            )

        history = _history(db, application.id)
        max_amount = constraints["asked_amount"] * constraints["amount_factor"]

        prompt = _USER_TEMPLATE.format(
            user_message=user_message,
            current_offer=json.dumps({
                "amount": current.amount,
                "interest_rate": current.interest_rate,
                "tenure_months": current.tenure_months,
                "emi": current.emi,
            }, indent=2),
            constraints=json.dumps(constraints, indent=2, default=float),
            history=json.dumps(history, indent=2) if history else "(no prior rounds)",
            rate_floor=constraints["rate_floor"],
            rate_ceiling=constraints["rate_ceiling"],
            max_tenure_months=constraints["max_tenure_months"],
            max_amount=max_amount,
            max_dti=constraints["max_dti"],
        )

        client = _client()
        try:
        
            resp = client.chat.completions.create(
                model=NEGOTIATION_MODEL,
                messages=[{"role": "system", "content": _SYSTEM},
                          {"role": "user",   "content": prompt}],
                temperature=0.3,
                max_tokens=500,
                response_format={"type": "json_object"},
                timeout=1.0,
            )
        except Exception as e:
            # Could be: invalid API key, rate limit, deprecated model, network error.
            # Surface the real reason so the user can fix it instead of seeing a generic 500.
            logger.exception("Groq negotiation call failed")
            cls = type(e).__name__
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"Negotiation LLM call failed ({cls}): {str(e)[:300]}",
            )

        raw = (resp.choices[0].message.content or "").strip()
        if not raw:
            logger.error("Negotiation LLM returned an empty response")
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "Negotiation agent returned an empty response.",
            )
        try:
            proposal = json.loads(raw)
        except json.JSONDecodeError as e:
            logger.error(f"Negotiation LLM returned non-JSON: {raw[:300]}")
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"Negotiation agent returned invalid JSON: {e}",
            )

        # Server-side guardrails :  we don't trust the model's math/limits.
        proposal = _enforce(proposal, constraints, current, max_amount)

        # If the borrower is signalling acceptance, don't mint a new offer row 
        # just echo the current offer back with the acceptance flag set so the
        # UI can show a "Confirm" CTA pointing at the existing offer id.
        if proposal["user_accepting"]:
            agent_msg = _strip_specific_figures(proposal.get("message_to_user", ""))
            db.add(AgentDecision(
                application_id=application.id,
                agent_name="negotiation",
                decision="user_signalled_accept",
                reasoning=agent_msg[:1000],
                llm_trace={"user_message": user_message, "proposal": proposal,
                           "model": NEGOTIATION_MODEL, "target_offer_id": current.id},
            ))
            db.commit()
            return {
                "offer": current,
                "agent_message": agent_msg,
                "concession": "none",
                "round": current.negotiation_round or 0,
                "dti": emi_to_income_ratio(current.emi, constraints["monthly_income"]),
                "user_accepting": True,
            }

        # Otherwise this is a true counter-offer — persist a new row.
        m = calculate(proposal["amount"], proposal["interest_rate"], proposal["tenure_months"])
        new_round = (current.negotiation_round or 0) + 1
        offer = LoanOffer(
            application_id=application.id,
            amount=m.principal,
            interest_rate=m.annual_rate_pct,
            tenure_months=m.tenure_months,
            emi=m.emi,
            is_recommended=True,
            is_negotiated=True,
            negotiation_round=new_round,
            accepted=False,
        )
        db.add(offer)
        agent_msg = _strip_specific_figures(proposal.get("message_to_user", ""))
        db.add(AgentDecision(
            application_id=application.id,
            agent_name="negotiation",
            decision=f"counter_round_{new_round}",
            reasoning=agent_msg[:1000],
            llm_trace={
                "user_message": user_message,
                "proposal": proposal,
                "model": NEGOTIATION_MODEL,
            },
        ))
        db.commit()
        db.refresh(offer)

        # Return the SQLAlchemy row directly — NegotiationResponse / LoanOfferOut
        # has `from_attributes=True` so Pydantic will pull every column off the
        # ORM object (including server-generated `created_at`).
        return {
            "offer": offer,
            "agent_message": agent_msg,
            "concession": proposal.get("concession", "none"),
            "round": new_round,
            "dti": emi_to_income_ratio(m.emi, constraints["monthly_income"]),
            "user_accepting": False,
        }


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _current_best_offer(db: Session, application_id: int) -> LoanOffer | None:
    """Return the most recent recommended/negotiated offer for this app."""
    return (
        db.query(LoanOffer)
        .filter(LoanOffer.application_id == application_id, LoanOffer.accepted.is_(False))
        .order_by(LoanOffer.id.desc())
        .first()
    )


def _history(db: Session, application_id: int, limit: int = 6) -> list[dict]:
    rows = (
        db.query(AgentDecision)
        .filter(
            AgentDecision.application_id == application_id,
            AgentDecision.agent_name == "negotiation",
        )
        .order_by(AgentDecision.id.asc())
        .limit(limit)
        .all()
    )
    return [{"round": i + 1, "summary": r.reasoning} for i, r in enumerate(rows)]


def _enforce(
    proposal: dict, constraints: dict, current: LoanOffer, max_amount: float
) -> dict:
    """Clamp the LLM's proposal to the hard bounds. We are the source of truth."""
    rate = float(proposal.get("interest_rate", current.interest_rate))
    rate = max(constraints["rate_floor"], min(constraints["rate_ceiling"], rate))

    tenure = int(proposal.get("tenure_months", current.tenure_months))
    tenure = max(12, min(constraints["max_tenure_months"], tenure))

    amount = float(proposal.get("amount", current.amount))
    amount = max(20_000, min(max_amount, amount))

    # Ensure DTI cap by trimming amount if needed.
    m = calculate(amount, rate, tenure)
    income = constraints["monthly_income"]
    if income > 0 and (m.emi / income) > constraints["max_dti"]:
        # solve for amount that hits the DTI cap exactly at the current rate/tenure
        # EMI = P * factor  →  P = (max_dti * income) / factor
        r = rate / 12 / 100
        if r > 0:
            factor = r * (1 + r) ** tenure / ((1 + r) ** tenure - 1)
        else:
            factor = 1 / tenure
        amount = max(20_000, min(max_amount, (constraints["max_dti"] * income) / factor))

    return {
        "amount":          round(amount, -2),                  # snap to nearest ₹100
        "interest_rate":   round(rate, 2),
        "tenure_months":   int(tenure),
        "message_to_user": proposal.get("message_to_user", ""),
        "concession":      proposal.get("concession", "none"),
        "user_accepting":  bool(proposal.get("user_accepting", False)),
    }


def _offer_dict(o: LoanOffer) -> dict:
    return {
        "id":                o.id,
        "application_id":    o.application_id,
        "amount":            o.amount,
        "interest_rate":     o.interest_rate,
        "tenure_months":     o.tenure_months,
        "emi":               o.emi,
        "is_recommended":    o.is_recommended,
        "is_negotiated":     o.is_negotiated,
        "negotiation_round": o.negotiation_round,
        "accepted":          o.accepted,
    }

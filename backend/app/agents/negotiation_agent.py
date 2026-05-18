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
from typing import Any

from fastapi import HTTPException, status
from groq import Groq
from sqlalchemy.orm import Session

from app.agents.decision_engine import DecisionEngine
from app.agents.emi import calculate, emi_to_income_ratio
from app.config import settings
from app.database.models import AgentDecision, LoanApplication, LoanOffer
from app.utils.logger import logger


NEGOTIATION_MODEL = "llama-3.3-70b-versatile"


_SYSTEM = """You are Saarthi's loan negotiation agent. You negotiate with a borrower
who wants a different amount, interest rate, or tenure. You MUST stay inside the
business constraints the engine gives you — never exceed rate_ceiling, never go
below rate_floor, never exceed max_tenure_months, never let EMI/income exceed max_dti.

You are helpful but firm. If the borrower asks for something outside policy,
counter with the closest legal option and explain why.

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
Propose ONE counter-offer that respects every constraint. Return strictly this JSON:

{{
  "amount":          number,
  "interest_rate":   number,
  "tenure_months":   integer,
  "message_to_user": "short 1-3 sentence explanation, friendly and direct",
  "concession":      "amount | rate | tenure | none — which lever you moved most"
}}

Rules:
- interest_rate must be between {rate_floor} and {rate_ceiling}
- tenure_months must be between 12 and {max_tenure_months}
- amount must be ≤ asked_amount × amount_factor ({max_amount})
- EMI/monthly_income must be ≤ {max_dti}
"""


def _client() -> Groq:
    if not settings.GROQ_API_KEY:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "GROQ_API_KEY is not configured.",
        )
    return Groq(api_key=settings.GROQ_API_KEY)


class NegotiationAgent:
    @staticmethod
    def negotiate(
        db: Session, application: LoanApplication, user_message: str
    ) -> dict[str, Any]:
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
        resp = client.chat.completions.create(
            model=NEGOTIATION_MODEL,
            messages=[{"role": "system", "content": _SYSTEM},
                      {"role": "user",   "content": prompt}],
            temperature=0.3,
            max_tokens=500,
            response_format={"type": "json_object"},
        )
        raw = resp.choices[0].message.content or ""
        try:
            proposal = json.loads(raw)
        except json.JSONDecodeError:
            logger.error(f"Negotiation LLM returned non-JSON: {raw[:300]}")
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "Negotiation agent returned an invalid response.",
            )

        # Server-side guardrails — we don't trust the model's math/limits.
        proposal = _enforce(proposal, constraints, current, max_amount)

        # Recompute EMI ourselves (no drift from the LLM's mental arithmetic).
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
        db.add(AgentDecision(
            application_id=application.id,
            agent_name="negotiation",
            decision=f"counter_round_{new_round}",
            reasoning=proposal.get("message_to_user", "")[:1000],
            llm_trace={
                "user_message": user_message,
                "proposal": proposal,
                "model": NEGOTIATION_MODEL,
            },
        ))
        db.commit()
        db.refresh(offer)

        return {
            "offer": _offer_dict(offer),
            "agent_message": proposal.get("message_to_user", ""),
            "concession": proposal.get("concession", "none"),
            "round": new_round,
            "dti": emi_to_income_ratio(m.emi, constraints["monthly_income"]),
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

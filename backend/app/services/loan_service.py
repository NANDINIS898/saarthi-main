"""
LoanApplication CRUD + ownership checks.

Keeps routes thin — every endpoint that takes an application_id resolves it
through LoanService.get() so we centralise the "you can only touch your own
applications" rule.
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.database.models import AuditEvent, LoanApplication, User
from app.schemas.loan import LoanApplicationCreate
from app.utils.logger import logger


class LoanService:
    @staticmethod
    def create(db: Session, user: User, payload: LoanApplicationCreate) -> LoanApplication:
        if not user.is_verified:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Complete KYC verification before applying for a loan.",
            )

        app = LoanApplication(
            user_id=user.id,
            loan_amount=payload.loan_amount,
            loan_purpose=payload.loan_purpose,
            monthly_income=payload.monthly_income,
            tenure_preference_months=payload.tenure_preference_months,
            status="kyc_pending" if user.kyc_status != "approved" else "underwriting",
        )
        db.add(app)
        db.add(AuditEvent(
            user_id=user.id,
            event_type="loan_application_created",
            payload={
                "loan_amount": payload.loan_amount,
                "loan_purpose": payload.loan_purpose,
                "tenure": payload.tenure_preference_months,
            },
        ))
        db.commit()
        db.refresh(app)
        logger.info(f"LoanApplication id={app.id} created for user_id={user.id}")
        return app

    @staticmethod
    def get(db: Session, application_id: int, user: User) -> LoanApplication:
        app = db.query(LoanApplication).filter(LoanApplication.id == application_id).first()
        if not app:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Application not found.")
        if app.user_id != user.id and not user.is_admin:
            # Don't leak existence of other users' apps
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Application not found.")
        return app

    @staticmethod
    def list_for_user(db: Session, user: User) -> list[LoanApplication]:
        return (
            db.query(LoanApplication)
            .filter(LoanApplication.user_id == user.id)
            .order_by(LoanApplication.id.desc())
            .all()
        )

"""
LoanApplication CRUD + ownership checks.

Keeps routes thin — every endpoint that takes an application_id resolves it
through LoanService.get() so we centralise the "you can only touch your own
applications" rule.
"""

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.database.models import AuditEvent, LoanApplication, User
from app.repositories.loan_repository import LoanRepository
from app.schemas.loan import LoanApplicationCreate
from app.utils.logger import logger


class LoanService:

    @staticmethod
    def create(db: Session,user: User,payload: LoanApplicationCreate) -> LoanApplication:

        # Business rule
        if not user.is_verified:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Complete KYC verification before applying for a loan.",
            )

        # Create application
        app = LoanApplication(
            user_id=user.id,
            loan_amount=payload.loan_amount,
            loan_purpose=payload.loan_purpose,
            monthly_income=payload.monthly_income,
            tenure_preference_months=payload.tenure_preference_months,
            status=(
                "kyc_pending"
                if user.kyc_status != "approved"
                else "underwriting"
            ),
        )

        # Create audit event
        audit_event = AuditEvent(
            user_id=user.id,
            event_type="loan_application_created",
            payload={
                "loan_amount": payload.loan_amount,
                "loan_purpose": payload.loan_purpose,
                "tenure": payload.tenure_preference_months,
            },
        )

        # Repository handles database operations
        repository = LoanRepository(db)

        app = repository.create(
            application=app,
            audit_event=audit_event,
        )

        logger.info(
            f"LoanApplication id={app.id} created "
            f"for user_id={user.id}"
        )

        return app

    @staticmethod
    def get(db: Session, application_id: int, user: User) -> LoanApplication:

        repository = LoanRepository(db)

        app = repository.get_by_id(application_id)

        if not app:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "Application not found."
            )

        # Authorization / ownership rule
        if app.user_id != user.id and not user.is_admin:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "Application not found."
            )

        return app

    @staticmethod
    def list_for_user(db: Session,user: User) -> list[LoanApplication]:

        repository = LoanRepository(db)

        return repository.list_for_user(user.id)
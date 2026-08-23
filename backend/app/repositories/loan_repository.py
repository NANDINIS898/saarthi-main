from sqlalchemy.orm import Session

from app.database.models import LoanApplication
from app.database.models import AuditEvent


class LoanRepository:

    def __init__(self, db: Session):
        self.db = db

    def create(self, application: LoanApplication, audit_event: AuditEvent) -> LoanApplication:
        self.db.add(application)
        self.db.add(audit_event)

        self.db.commit()
        self.db.refresh(application)

        return application



    def get_by_id(self, application_id: int) -> LoanApplication | None:
        return (
            self.db.query(LoanApplication)
            .filter(LoanApplication.id == application_id)
            .first()
        )

    def list_for_user(self, user_id: int) -> list[LoanApplication]:
        return (
            self.db.query(LoanApplication)
            .filter(LoanApplication.user_id == user_id)
            .order_by(LoanApplication.id.desc())
            .all()
        )



   
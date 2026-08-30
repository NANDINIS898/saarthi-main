"""
User repository.

Responsible ONLY for database access related to User.

No business logic.
No password hashing.
No JWT logic.
No HTTPException.
"""

from sqlalchemy.orm import Session

from app.database.models import User


class UserRepository:

    def __init__(self, db: Session):
        self.db = db

    # ---------------------------------------------------------
    # GET BY EMAIL
    # ---------------------------------------------------------

    def get_by_email(self, email: str) -> User | None:
        return (
            self.db.query(User)
            .filter(User.email == email)
            .first()
        )

    # ---------------------------------------------------------
    # GET BY PHONE
    # ---------------------------------------------------------

    def get_by_phone(self, phone: str) -> User | None:
        return (
            self.db.query(User)
            .filter(User.phone == phone)
            .first()
        )

    # ---------------------------------------------------------
    # GET BY ID
    # ---------------------------------------------------------

    def get_by_id(self, user_id: int) -> User | None:
        return (
            self.db.query(User)
            .filter(User.id == user_id)
            .first()
        )

    # ---------------------------------------------------------
    # CREATE
    # ---------------------------------------------------------

    def create(self, user: User) -> User:
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)

        return user
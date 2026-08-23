from sqlalchemy.orm import Session

from app.database.models import User


class UserRepository:

    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, user_id: int) -> User | None:
        return (
            self.db.query(User)
            .filter(User.id == user_id)
            .first()
        )

    def get_by_email(self, email: str) -> User | None:
        return (
            self.db.query(User)
            .filter(User.email == email)
            .first()
        )

    def get_by_phone(self, phone: str) -> User | None:
        return (
            self.db.query(User)
            .filter(User.phone == phone)
            .first()
        )

    def list_users(
        self,
        skip: int = 0,
        limit: int = 50,
    ) -> list[User]:
        return (
            self.db.query(User)
            .offset(skip)
            .limit(limit)
            .all()
        )

    def create(self, user: User) -> User:
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)

        return user
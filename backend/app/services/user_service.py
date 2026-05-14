"""
User service: business logic for the User resource.

Routes call into this layer. This layer talks to the DB.
Never let DB-layer details (SQLAlchemy errors, raw queries) leak into routes.
"""

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.models import User
from app.schemas.user import UserCreate
from app.utils.logger import logger
from app.utils.security import hash_password


class UserService:
    @staticmethod
    def create_user(db: Session, user_data: UserCreate) -> User:
        # Pre-check to give a clean error message instead of a raw IntegrityError
        existing = db.query(User).filter(User.email == user_data.email).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A user with this email already exists.",
            )

        user = User(
            full_name=user_data.full_name,
            email=user_data.email,
            phone=user_data.phone,
            hashed_password=hash_password(user_data.password),
        )

        try:
            db.add(user)
            db.commit()
            db.refresh(user)
        except IntegrityError as e:
            db.rollback()
            logger.error(f"IntegrityError creating user: {e}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User could not be created (duplicate email or phone).",
            )

        logger.info(f"Created user id={user.id} email={user.email}")
        return user

    @staticmethod
    def get_user_by_id(db: Session, user_id: int) -> User:
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User {user_id} not found.",
            )
        return user

    @staticmethod
    def list_users(db: Session, skip: int = 0, limit: int = 50):
        return db.query(User).offset(skip).limit(limit).all()
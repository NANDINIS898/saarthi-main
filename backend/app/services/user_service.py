

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.models import User
from app.repositories.user_repository import UserRepository
from app.schemas.user import UserCreate
from app.utils.logger import logger
from app.utils.security import hash_password


class UserService:

    @staticmethod
    def create_user(
        db: Session,
        user_data: UserCreate, 
    ) -> User:

        repository = UserRepository(db)

        # Business rule:
        # Email must be unique
        existing = repository.get_by_email(user_data.email)

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
            user = repository.create(user)

        except IntegrityError as e:
            db.rollback()

            logger.error(
                f"IntegrityError creating user: {e}"
            )

            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User could not be created "
                       "(duplicate email or phone).",
            )

        logger.info(
            f"Created user id={user.id} email={user.email}"
        )

        return user

    @staticmethod
    def get_user_by_id(
        db: Session,
        user_id: int,
    ) -> User:

        repository = UserRepository(db)

        user = repository.get_by_id(user_id)

        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User {user_id} not found.",
            )

        return user

    @staticmethod
    def get_user_by_email(
        db: Session,
        email: str,
    ) -> User | None:

        repository = UserRepository(db)

        return repository.get_by_email(email)

    @staticmethod
    def list_users(
        db: Session,
        skip: int = 0,
        limit: int = 50,
    ) -> list[User]:

        repository = UserRepository(db)

        return repository.list_users(
            skip=skip,
            limit=limit,
        )
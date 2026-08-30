"""
User repository.

Responsible only for database access related to User.

The repository knows about SQLAlchemy.
Services do not.
"""

from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.database.models import User
from app.schemas.user import UserCreate
from app.utils.security import hash_password
from app.repositories.user_repository import UserRepository


class UserService:

    def __init__(self, user_repository: UserRepository):
        self.user_repository = user_repository


    # ─────────────────────────────────────────────
    # GET USER BY ID
    # ─────────────────────────────────────────────
    def create_user(self, payload: UserCreate) -> User:
        """
        Create a new user.

        Business logic:
        - check email uniqueness
        - check phone uniqueness
        - hash password
        - create user

        Database operations are delegated to UserRepository.
        """

        # -----------------------------------------------------
        # Check duplicate email
        # -----------------------------------------------------

        existing_email = self.user_repository.get_by_email(
            payload.email
        )

        if existing_email:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Email already registered.",
            )

        # -----------------------------------------------------
        # Check duplicate phone
        # -----------------------------------------------------

        if payload.phone:

            existing_phone = self.user_repository.get_by_phone(
                payload.phone
            )

            if existing_phone:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Phone number already registered.",
                )

        # -----------------------------------------------------
        # Hash password
        # -----------------------------------------------------

        hashed_password = hash_password(
            payload.password
        )

        # -----------------------------------------------------
        # Build domain/model object
        # -----------------------------------------------------

        user = User(
            full_name=payload.full_name,
            email=payload.email,
            phone=payload.phone,
            hashed_password=hashed_password,
            is_active=True,
            is_verified=False,
            is_admin=False,
            kyc_status="pending",
        )

        # -----------------------------------------------------
        # Persist through repository
        # -----------------------------------------------------

        return self.user_repository.create(user)

     # =========================================================
    # GET USER BY EMAIL
    # =========================================================

    def get_user_by_email(
        self,
        email: str,
    ) -> User | None:

        return self.user_repository.get_by_email(email)

    # =========================================================
    # GET USER BY ID
    # =========================================================

    def get_user_by_id(
        self,
        user_id: int,
    ) -> User | None:

        return self.user_repository.get_by_id(user_id)
"""
Auth service: signup, login, identity resolution from JWT.

Routes call into this layer.

This layer is responsible for authentication business logic
and delegates database operations to UserRepository.

The service does NOT directly know about SQLAlchemy Session
or database queries.
"""

from fastapi import HTTPException, status
from jose import JWTError

from app.config import settings
from app.database.models import User
from app.repositories.user_repository import UserRepository
from app.schemas.auth import SignupRequest, TokenResponse
from app.schemas.user import UserCreate
from app.services.user_service import UserService
from app.utils.jwt import create_access_token, decode_access_token
from app.utils.logger import logger
from app.utils.security import verify_password


class AuthService:

    def __init__(
        self,
        user_repository: UserRepository,
    ):
        self.user_repository = user_repository

    # ──────────────────────────────────────────────────────────────────────
    # SIGNUP
    # ──────────────────────────────────────────────────────────────────────

    def signup(
        self,
        payload: SignupRequest,
    ) -> User:
        """
        Create a new user.

        UserService handles user creation/business rules.
        UserRepository handles database persistence.
        """

        user = UserService.create_user(
            self.user_repository,
            UserCreate(
                full_name=payload.full_name,
                email=payload.email,
                phone=payload.phone,
                password=payload.password,
            ),
        )

        logger.info(
            f"Signup OK user_id={user.id}"
        )

        return user

    # ──────────────────────────────────────────────────────────────────────
    # LOGIN
    # ──────────────────────────────────────────────────────────────────────

    def login(
        self,
        email: str,
        password: str,
    ) -> TokenResponse:
        """
        Verify credentials and return an access token.
        """

        user = self.user_repository.get_by_email(email)

        # Same generic error for:
        # - user does not exist
        # - password is incorrect
        #
        # This prevents leaking which emails are registered.
        if (
            not user
            or not verify_password(
                password,
                user.hashed_password,
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )

        # Account status is business logic.
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled.",
            )

        # JWT generation belongs to authentication service.
        token = create_access_token(
            subject=user.id
        )

        logger.info(
            f"Login OK user_id={user.id}"
        )

        return TokenResponse(
            access_token=token,
            expires_in_minutes=(
                settings.ACCESS_TOKEN_EXPIRE_MINUTES
            ),
        )

    # ──────────────────────────────────────────────────────────────────────
    # JWT → USER
    # ──────────────────────────────────────────────────────────────────────

    def user_from_token(
        self,
        token: str,
    ) -> User:
        """
        Decode a bearer token and return the matching user.

        Raises 401 for invalid/malformed tokens or missing users.
        """

        creds_exc = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        )

        # ──────────────────────────────────────────────────────────────────
        # Decode JWT
        # ──────────────────────────────────────────────────────────────────

        try:

            payload = decode_access_token(token)

        except JWTError as e:

            logger.warning(
                f"JWT decode failed: {e}"
            )

            raise creds_exc

        # ──────────────────────────────────────────────────────────────────
        # Extract subject
        # ──────────────────────────────────────────────────────────────────

        sub = payload.get("sub")

        if not sub:
            raise creds_exc

        try:

            user_id = int(sub)

        except (TypeError, ValueError):

            raise creds_exc

        # ──────────────────────────────────────────────────────────────────
        # Load user through repository
        # ──────────────────────────────────────────────────────────────────

        user = self.user_repository.get_by_id(
            user_id
        )

        if not user:
            raise creds_exc

        # ──────────────────────────────────────────────────────────────────
        # Account status
        # ──────────────────────────────────────────────────────────────────

        if not user.is_active:

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled.",
            )

        return user


"""
Authentication service.

Responsible for:
- signup
- login
- JWT authentication
- resolving the current user

AuthService does NOT perform database queries directly.

Dependency direction:

AuthService
    ↓
UserService
    ↓
UserRepository
    ↓
Database
"""

from fastapi import HTTPException, status
from jose import JWTError

from app.config import settings
from app.database.models import User
from app.schemas.auth import SignupRequest, TokenResponse
from app.schemas.user import UserCreate
from app.services.user_service import UserService
from app.utils.jwt import create_access_token, decode_access_token
from app.utils.logger import logger
from app.utils.security import verify_password


class AuthService:

    def __init__(
        self,
        user_service: UserService,
    ):
        self.user_service = user_service

    # =========================================================
    # SIGNUP
    # =========================================================

    def signup(
        self,
        payload: SignupRequest,
    ) -> User:

        user = self.user_service.create_user(
            UserCreate(
                full_name=payload.full_name,
                email=payload.email,
                phone=payload.phone,
                password=payload.password,
            )
        )

        logger.info(
            f"Signup OK user_id={user.id}"
        )

        return user

    # =========================================================
    # LOGIN
    # =========================================================

    def login(
        self,
        email: str,
        password: str,
    ) -> TokenResponse:

        user = self.user_service.get_user_by_email(
            email
        )

        # Don't reveal whether the email exists.
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

        # -----------------------------------------------------
        # Disabled account
        # -----------------------------------------------------

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled.",
            )

        # -----------------------------------------------------
        # Create JWT
        # -----------------------------------------------------

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

    # =========================================================
    # USER FROM JWT
    # =========================================================

    def user_from_token(
        self,
        token: str,
    ) -> User:

        credentials_exception = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials.",
            headers={
                "WWW-Authenticate": "Bearer"
            },
        )

        # -----------------------------------------------------
        # Decode token
        # -----------------------------------------------------

        try:

            payload = decode_access_token(token)

        except JWTError as e:

            logger.warning(
                f"JWT decode failed: {e}"
            )

            raise credentials_exception

        # -----------------------------------------------------
        # Get subject
        # -----------------------------------------------------

        sub = payload.get("sub")

        if not sub:
            raise credentials_exception

        try:

            user_id = int(sub)

        except (TypeError, ValueError):

            raise credentials_exception

        # -----------------------------------------------------
        # Get user through service
        # -----------------------------------------------------

        user = self.user_service.get_user_by_id(
            user_id
        )

        if not user:
            raise credentials_exception

        # -----------------------------------------------------
        # Check account
        # -----------------------------------------------------

        if not user.is_active:

            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled.",
            )

        return user
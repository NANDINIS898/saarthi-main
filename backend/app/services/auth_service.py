"""
Auth service: signup, login, identity resolution from JWT.

Routes call into this layer. This layer talks to UserService + JWT utils.
Never let token / hashing details leak into routes.
"""

from fastapi import HTTPException, status
from jose import JWTError
from sqlalchemy.orm import Session

from app.config import settings
from app.database.models import User
from app.schemas.auth import SignupRequest, TokenResponse
from app.schemas.user import UserCreate
from app.services.user_service import UserService
from app.utils.jwt import create_access_token, decode_access_token
from app.utils.logger import logger
from app.utils.security import verify_password


class AuthService:
    @staticmethod
    def signup(db: Session, payload: SignupRequest) -> User:
        """Create a new user. Delegates dedupe + hashing to UserService."""
        user = UserService.create_user(
            db,
            UserCreate(
                full_name=payload.full_name,
                email=payload.email,
                phone=payload.phone,
                password=payload.password,
            ),
        )
        logger.info(f"Signup OK user_id={user.id}")
        return user

    @staticmethod
    def login(db: Session, email: str, password: str) -> TokenResponse:
        """Verify credentials, return an access token."""
        user = UserService.get_user_by_email(db, email)
        # Same generic error for missing user + bad password — don't leak which.
        if not user or not verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password.",
            )
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled.",
            )

        token = create_access_token(subject=user.id)
        logger.info(f"Login OK user_id={user.id}")
        return TokenResponse(
            access_token=token,
            expires_in_minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES,
        )

    @staticmethod
    def user_from_token(db: Session, token: str) -> User:
        """Decode a bearer token and return the matching user, or raise 401."""
        creds_exc = HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )
        try:
            payload = decode_access_token(token)
        except JWTError as e:
            logger.warning(f"JWT decode failed: {e}")
            raise creds_exc

        sub = payload.get("sub")
        if not sub:
            raise creds_exc

        try:
            user_id = int(sub)
        except (TypeError, ValueError):
            raise creds_exc

        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise creds_exc
        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Account is disabled.",
            )
        return user

"""
Shared FastAPI dependencies.

Routes use these to inject the current authenticated user (or current admin)
without re-implementing token parsing each time.
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import User
from app.services.auth_service import AuthService


# tokenUrl is what Swagger uses for the "Authorize" button.
# Auto-error=False lets us return our own clean 401 with WWW-Authenticate header.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=True)


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the bearer token to a User row. Raises 401 if invalid."""
    return AuthService.user_from_token(db, token)


def get_current_admin(
    user: User = Depends(get_current_user),
) -> User:
    """Stack on top of `get_current_user` to gate admin-only routes."""
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required.",
        )
    return user

"""
FastAPI dependency injection.

Builds the dependency chain:

Database Session
    ↓
UserRepository
    ↓
UserService
    ↓
AuthService
"""

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.database.models import User

from app.database.connection import get_db
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService
from app.services.user_service import UserService


# ─────────────────────────────────────────────
# JWT TOKEN DEPENDENCY
# ─────────────────────────────────────────────

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/auth/login"
)

# =============================================================
# USER REPOSITORY
# =============================================================

def get_user_repository(
    db: Session = Depends(get_db),
) -> UserRepository:

    return UserRepository(db)


# =============================================================
# USER SERVICE
# =============================================================

def get_user_service(
    user_repository: UserRepository = Depends(
        get_user_repository
    ),
) -> UserService:

    return UserService(
        user_repository
    )


# =============================================================
# AUTH SERVICE
# =============================================================

def get_auth_service(
    user_service: UserService = Depends(
        get_user_service
    ),
) -> AuthService:

    return AuthService(
        user_service
    )
def get_current_user( token: str = Depends(oauth2_scheme), auth_service: AuthService = Depends( get_auth_service ), ) -> User:
    return auth_service.user_from_token( token )
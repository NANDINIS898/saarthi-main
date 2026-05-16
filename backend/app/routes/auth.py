"""
Auth routes — signup, login, current user.

POST /auth/signup  -> create user
POST /auth/login   -> exchange email+password for JWT
GET  /auth/me      -> who am I (requires Bearer token)
"""

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.database.models import User
from app.schemas.auth import (
    LoginRequest,
    MeResponse,
    SignupRequest,
    TokenResponse,
)
from app.services.auth_service import AuthService
from app.utils.deps import get_current_user

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/signup", response_model=MeResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    """Register a new user."""
    return AuthService.signup(db, payload)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """Exchange email + password for a JWT access token."""
    return AuthService.login(db, payload.email, payload.password)


@router.get("/me", response_model=MeResponse)
def me(current_user: User = Depends(get_current_user)):
    """Return the user identified by the bearer token."""
    return current_user

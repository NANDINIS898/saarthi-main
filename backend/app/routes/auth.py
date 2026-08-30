from fastapi import APIRouter, Depends, status

from sqlalchemy.orm import Session

from app.database.models import User
from app.schemas.auth import (
    LoginRequest,
    SignupRequest,
    TokenResponse,
    MeResponse
)

from app.services.auth_service import AuthService
from app.utils.deps import (
    get_auth_service,
    get_current_user,
)


router = APIRouter(
    prefix="/auth",
    tags=["Authentication"],
)

@router.post(
    "/signup",
    response_model=MeResponse,
    status_code=status.HTTP_201_CREATED,
)
def signup(
    payload: SignupRequest,
    auth_service: AuthService = Depends(get_auth_service),
):
    """Register a new user."""

    return auth_service.signup(payload)


@router.post(
    "/login",
    response_model=TokenResponse,
)
def login(
    payload: LoginRequest,
    auth_service: AuthService = Depends(get_auth_service),
):
    """Exchange email + password for a JWT."""

    return auth_service.login(
        payload.email,
        payload.password,
    )


@router.get(
    "/me",
    response_model=MeResponse,
)
def me(
    current_user: User = Depends(get_current_user),
):
    """Return the authenticated user."""

    return current_user

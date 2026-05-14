"""
User routes.

Notice how thin these handlers are — they only:
  1. Receive a validated payload (Pydantic does the validation)
  2. Inject a DB session
  3. Delegate to the service layer
  4. Return the result (FastAPI serializes via response_model)
"""

from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database.connection import get_db
from app.schemas.user import UserCreate, UserResponse
from app.services.user_service import UserService

router = APIRouter(prefix="/users", tags=["Users"])


@router.post("/", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db)):
    """Register a new user."""
    return UserService.create_user(db, payload)


@router.get("/{user_id}", response_model=UserResponse)
def get_user(user_id: int, db: Session = Depends(get_db)):
    """Fetch a user by ID."""
    return UserService.get_user_by_id(db, user_id)


@router.get("/", response_model=List[UserResponse])
def list_users(skip: int = 0, limit: int = 50, db: Session = Depends(get_db)):
    """List users with pagination."""
    return UserService.list_users(db, skip=skip, limit=limit)
"""
Pydantic schemas for auth (signup, login, token responses).
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


# ---------- Inbound ----------
class SignupRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone: Optional[str] = Field(None, max_length=20)
    password: str = Field(..., min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


# ---------- Outbound ----------
class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_minutes: int


class MeResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    phone: Optional[str] = None
    is_active: bool
    is_verified: bool
    is_admin: bool
    kyc_status: str
    created_at: datetime

    model_config = {"from_attributes": True}

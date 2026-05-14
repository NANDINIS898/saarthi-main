"""
Pydantic schemas for the User resource.

Naming convention:
  - <Name>Base       : shared fields
  - <Name>Create     : payload for POST
  - <Name>Update     : payload for PATCH
  - <Name>Response   : payload returned by API
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class UserBase(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone: Optional[str] = Field(None, max_length=20)


class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=128)


class UserResponse(UserBase):
    id: int
    is_active: bool
    is_verified: bool
    kyc_status: str
    created_at: datetime

    model_config = {"from_attributes": True}  # allows ORM -> schema conversion
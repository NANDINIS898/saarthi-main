"""
JWT helpers — issue & decode access tokens.

We use python-jose with HS256. The signing secret comes from settings.SECRET_KEY.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from jose import JWTError, jwt

from app.config import settings


def create_access_token(subject: str | int, expires_minutes: Optional[int] = None) -> str:
    """
    Return a signed JWT whose `sub` claim is the user id.

    `expires_minutes` overrides the default from settings if provided
    (useful for tests).
    """
    expire_minutes = expires_minutes or settings.ACCESS_TOKEN_EXPIRE_MINUTES
    expire = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)

    payload: dict[str, Any] = {
        "sub": str(subject),
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "type": "access",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """
    Decode + verify a JWT. Raises `jose.JWTError` on bad signature / expiry.
    Callers should catch JWTError and turn it into a 401.
    """
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])


__all__ = ["create_access_token", "decode_access_token", "JWTError"]

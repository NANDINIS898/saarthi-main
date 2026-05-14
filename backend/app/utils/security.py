"""
Security utilities: password hashing & verification.

We use bcrypt via passlib — never store plaintext passwords.
"""

from passlib.context import CryptContext


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Return a bcrypt hash of the plaintext password."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Return True if plaintext matches the stored hash."""
    return pwd_context.verify(plain_password, hashed_password)
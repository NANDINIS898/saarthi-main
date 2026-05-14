"""
Application configuration.

Loads environment variables from .env using pydantic-settings, validates them,
and exposes a singleton `settings` object used across the app.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # ---------- Application ----------
    APP_NAME: str = "Saarthi"
    APP_ENV: str = "development"
    DEBUG: bool = True

    # ---------- Database ----------
    DATABASE_URL: str

    # ---------- JWT / Auth ----------
    SECRET_KEY: str = "change-me"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # ---------- External APIs ----------
    GEMINI_API_KEY: str = ""

    # ---------- CORS ----------
    FRONTEND_URL: str = "http://localhost:5173"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )


# Singleton instance imported across the codebase
settings = Settings()
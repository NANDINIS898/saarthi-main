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
    GROQ_API_KEY: str = ""

    # ---------- Supabase Storage (Phase 2 — KYC media) ----------
    # Dashboard → Project Settings → API
    SUPABASE_URL: str = ""                       # e.g. https://<ref>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY: str = ""          # server-only; bypasses RLS. NEVER ship to frontend.
    SUPABASE_STORAGE_BUCKET: str = "kyc-media"   # create this bucket in Supabase dashboard (private)

    # ---------- Upload limits ----------
    MAX_VIDEO_BYTES: int = 50 * 1024 * 1024      # 50 MB
    MAX_IMAGE_BYTES: int = 8 * 1024 * 1024       # 8 MB

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
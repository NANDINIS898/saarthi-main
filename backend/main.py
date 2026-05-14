"""
Saarthi backend entry point.

Run with:
    uvicorn main:app --reload --port 8000
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import models  # noqa: F401 -- ensures models are registered with Base
from app.database.connection import Base, engine
from app.routes import health, users
from app.utils.logger import logger


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Runs on startup & shutdown."""
    logger.info(f"Starting {settings.APP_NAME} backend in {settings.APP_ENV} mode...")
    # For Phase 1 we auto-create tables. In production we'll switch to Alembic migrations.
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables ensured.")
    yield
    logger.info(f"Shutting down {settings.APP_NAME} backend.")


app = FastAPI(
    title=settings.APP_NAME,
    description="AI-Powered Loan Underwriting & Onboarding Platform",
    version="0.1.0",
    lifespan=lifespan,
)

# ---------- Middleware ----------
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.FRONTEND_URL,
        "http://localhost:3000",  # CRA default
        "http://localhost:5173",  # Vite default
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Routers ----------
app.include_router(health.router)
app.include_router(users.router)


@app.get("/", tags=["Root"])
def root():
    return {
        "message": f"Welcome to {settings.APP_NAME} API",
        "docs": "/docs",
        "health": "/health",
    }
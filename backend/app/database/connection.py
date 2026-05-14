"""
Database engine + session management.

`get_db` is the FastAPI dependency that yields a request-scoped DB session
and guarantees it gets closed even if the route raises.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from app.config import settings


# pool_pre_ping=True silently reconnects if Postgres dropped the connection
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    echo=False,  # set True for SQL debugging
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base class that all SQLAlchemy models inherit from
Base = declarative_base()


def get_db():
    """FastAPI dependency: yields a DB session, ensures it's closed."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
"""
Alembic environment.

Wires Alembic to:
  - our SQLAlchemy Base.metadata  (so --autogenerate sees model changes)
  - our pydantic settings.DATABASE_URL  (single source of truth for the DB URL)
"""

import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

# Make `app` importable when alembic runs from the backend/ directory.
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app.config import settings  # noqa: E402
from app.database.connection import Base  # noqa: E402
from app.database import models  # noqa: E402, F401  -- register models with Base

config = context.config

# Inject our DATABASE_URL into Alembic's config so we never duplicate it in alembic.ini.
# ConfigParser treats `%` as interpolation, so percent-encoded passwords need `%` -> `%%`.
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()

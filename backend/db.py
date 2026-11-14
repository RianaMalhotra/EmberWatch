"""Database connection for the shared Supabase (PostgreSQL + PostGIS) database.

The connection string is read from the DATABASE_URL environment variable,
which is loaded from backend/.env (never committed). See backend/.env.example.
"""

import os

import psycopg
from dotenv import load_dotenv

load_dotenv()


class DatabaseNotConfigured(RuntimeError):
    """Raised when DATABASE_URL is not set."""


def get_database_url():
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        raise DatabaseNotConfigured(
            "DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill it in."
        )
    return url


def get_statement_timeout_ms():
    """Optional cap on how long one query may run (DB_STATEMENT_TIMEOUT_MS, #49).

    Unset (the default) means no cap. A bad value is ignored rather than
    stopping the API from starting. Some Supabase poolers reject startup
    options, so this is opt-in: set it only after checking your connection.
    """
    raw = os.environ.get("DB_STATEMENT_TIMEOUT_MS", "").strip()
    try:
        value = int(raw)
    except ValueError:
        return None
    return value if value > 0 else None


def get_connection():
    """Open a new database connection. Use it with ``with get_connection() as conn:``.

    A connection that can't be opened within 5 s fails (connect_timeout), and
    with DB_STATEMENT_TIMEOUT_MS set a slow query is cancelled by the database.
    Either way the routes answer 503 instead of hanging.
    """
    options = {}
    timeout_ms = get_statement_timeout_ms()
    if timeout_ms:
        options["options"] = f"-c statement_timeout={timeout_ms}"
    return psycopg.connect(get_database_url(), connect_timeout=5, **options)


def check_database():
    """Return (True, None) if the database answers, else (False, reason)."""
    try:
        with get_connection() as conn:
            conn.execute("select 1")
        return True, None
    except DatabaseNotConfigured as error:
        return False, str(error)
    except psycopg.Error:
        # Don't leak connection details (host, user) in the API response.
        return False, "Database is unavailable"

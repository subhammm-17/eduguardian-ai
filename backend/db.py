"""Where EduGuardian AI saves accounts, logins, files and progress.

Two places, chosen automatically:
- On your computer: a small SQLite file, backend/users.db (nothing to set up).
- Online: a free hosted Postgres database, when DATABASE_URL is set in the
  host's Environment settings (for example a free database from neon.com).
  Free hosts like Render wipe their own disk every time the site restarts or
  goes to sleep, so a file like users.db would lose every account there.

The rest of the code writes SQLite-style SQL (with ? for values) and uses
`with connect() as conn:`. This file makes the same code work on Postgres.
"""
import atexit
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).with_name("users.db")
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
USING_POSTGRES = bool(DATABASE_URL)
if os.getenv("EDUGUARDIAN_HOSTED", "") == "1" and not USING_POSTGRES:
    # Shows in the host's Logs: accounts would vanish at the next restart
    print("[warning] DATABASE_URL is not set, so accounts are saved on this server's disk, "
          "which free hosts wipe on every restart. See DEPLOY.md, step 2.", flush=True)


# ---------- SQLite (your computer) ----------
@contextmanager
def _sqlite():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")  # a file or session can't point to a missing user
    try:
        with conn:
            yield conn
    finally:
        conn.close()


# ---------- Postgres (online) ----------
class Row(dict):
    """A result row that works like sqlite3.Row: row["name"] and row[0] both work."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def _row_factory(cursor):
    names = [column.name for column in cursor.description or ()]  # no columns, e.g. for a quick "are you there?" check
    return lambda values: Row(zip(names, values))


def _to_postgres(sql):
    """Turns our SQLite-style SQL into Postgres SQL."""
    return (sql.replace("?", "%s")
               .replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
               .replace("BLOB", "BYTEA"))


class _PostgresConnection:
    """Gives a Postgres connection the same conn.execute(sql, values) as SQLite."""

    def __init__(self, conn):
        self.conn = conn

    def execute(self, sql, params=()):
        return self.conn.execute(_to_postgres(sql), params)


_pool = None


def _get_pool():
    # A pool keeps a few connections open, so each request doesn't wait for a new one.
    # check= tests a connection before using it, because the free database
    # goes to sleep after 5 quiet minutes and closes old connections.
    global _pool
    if _pool is None:
        from psycopg_pool import ConnectionPool  # only needed online
        _pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=10, open=True,
                               # prepare_threshold=None: works with every kind of hosted Postgres
                               kwargs={"row_factory": _row_factory, "prepare_threshold": None},
                               check=ConnectionPool.check_connection)
        atexit.register(_pool.close)  # close the connections when the server stops
    return _pool


@contextmanager
def _postgres():
    # Saves the changes if everything worked, undoes them if there was an error
    with _get_pool().connection() as conn:
        yield _PostgresConnection(conn)


def connect():
    """Use as `with connect() as conn:`. Saves the changes if everything worked,
    undoes them if there was an error, and always closes the connection afterwards."""
    return _postgres() if USING_POSTGRES else _sqlite()


def add_column(conn, table, column, definition):
    """Adds a column to a table made by an older version, if it isn't there yet."""
    if USING_POSTGRES:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {_to_postgres(definition)}")
        return
    columns = [row["name"] for row in conn.execute(f"PRAGMA table_info({table})")]
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

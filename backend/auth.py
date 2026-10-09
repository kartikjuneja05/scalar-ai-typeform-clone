"""Creator accounts and browser-scoped guests with opaque cookie sessions."""
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
import uuid
from dataclasses import dataclass

from fastapi import HTTPException, Request, Response
from pydantic import BaseModel, Field, field_validator

COOKIE = "iloveforms_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
ITERATIONS = 600_000


@dataclass(frozen=True)
class Creator:
    id: str
    name: str
    email: str | None
    is_guest: bool

    def profile(self):
        return {"name": self.name, "email": self.email, "is_guest": self.is_guest}


class Credentials(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            raise ValueError("Enter a valid email address")
        return value


class Registration(Credentials):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def valid_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Please enter your name")
        return value


def password_hash(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt}${digest.hex()}"


def check_password(password, stored):
    try:
        algorithm, iterations, salt, digest = stored.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        computed = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations)).hex()
        return hmac.compare_digest(computed, digest)
    except (ValueError, AttributeError):
        return False


def init_auth(c):
    c.executescript("""
    CREATE TABLE IF NOT EXISTS creators(
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE,
        password_hash TEXT, is_guest INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sessions(
        token_hash TEXT PRIMARY KEY,
        creator_id TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_creator ON sessions(creator_id);
    """)
    columns = {row["name"] for row in c.execute("PRAGMA table_info(forms)")}
    if "owner_id" not in columns:
        c.execute("ALTER TABLE forms ADD COLUMN owner_id TEXT REFERENCES creators(id)")
    c.execute("CREATE INDEX IF NOT EXISTS forms_owner ON forms(owner_id)")


def from_row(row):
    return Creator(row["id"], row["name"], row["email"], bool(row["is_guest"]))


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def issue_session(c, response, creator_id):
    token = secrets.token_urlsafe(32)
    c.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
    c.execute("INSERT INTO sessions VALUES(?,?,?)", (token_digest(token), creator_id, int(time.time()) + SESSION_SECONDS))
    response.set_cookie(
        COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
        secure=os.environ.get("COOKIE_SECURE", "false").lower() == "true",
        samesite="lax", path="/",
    )


def lookup(c, request):
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    row = c.execute("""
        SELECT creators.* FROM sessions JOIN creators ON creators.id=sessions.creator_id
        WHERE token_hash=? AND expires_at>?
    """, (token_digest(token), int(time.time()))).fetchone()
    return from_row(row) if row else None


def revoke(c, request):
    token = request.cookies.get(COOKIE)
    if token:
        c.execute("DELETE FROM sessions WHERE token_hash=?", (token_digest(token),))


def guest(c, response):
    creator_id = uuid.uuid4().hex
    c.execute("INSERT INTO creators(id,name,is_guest) VALUES(?, 'guest', 1)", (creator_id,))
    # Preserve existing pre-account forms for the first guest opening this installation.
    c.execute("UPDATE forms SET owner_id=? WHERE owner_id IS NULL", (creator_id,))
    issue_session(c, response, creator_id)
    return Creator(creator_id, "guest", None, True)


def resolve(c, request, response):
    response.headers["Cache-Control"] = "no-store"
    creator = lookup(c, request)
    return creator if creator else guest(c, response)


def register(c, request, response, data):
    # Hash outside the write transaction; registration is validated by Pydantic first.
    hashed = password_hash(data.password)
    c.execute("BEGIN IMMEDIATE")
    if c.execute("SELECT id FROM creators WHERE email=?", (data.email,)).fetchone():
        raise HTTPException(409, "An account with this email already exists. Please sign in.")
    current = lookup(c, request)
    if current and current.is_guest:
        creator_id = current.id
        c.execute("UPDATE creators SET name=?,email=?,password_hash=?,is_guest=0 WHERE id=?", (data.name, data.email, hashed, creator_id))
        # Invalidate any older guest session after upgrading to an account.
        c.execute("DELETE FROM sessions WHERE creator_id=?", (creator_id,))
    else:
        creator_id = uuid.uuid4().hex
        c.execute("INSERT INTO creators VALUES(?,?,?,?,0)", (creator_id, data.name, data.email, hashed))
        revoke(c, request)
    issue_session(c, response, creator_id)
    response.headers["Cache-Control"] = "no-store"
    return Creator(creator_id, data.name, data.email, False).profile()


def login(c, request, response, data):
    row = c.execute("SELECT * FROM creators WHERE email=? AND is_guest=0", (data.email,)).fetchone()
    # Perform the same password derivation even when the account does not exist.
    stored = row["password_hash"] if row else f"pbkdf2_sha256${ITERATIONS}${'00' * 16}${'00' * 32}"
    if not check_password(data.password, stored):
        raise HTTPException(401, "Email or password is incorrect.")
    c.execute("BEGIN IMMEDIATE")
    current = lookup(c, request)
    if current and current.is_guest:
        c.execute("UPDATE forms SET owner_id=? WHERE owner_id=?", (row["id"], current.id))
    revoke(c, request)
    issue_session(c, response, row["id"])
    response.headers["Cache-Control"] = "no-store"
    return from_row(row).profile()

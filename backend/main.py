"""SQLite-backed form API. Creator accounts and guests own their forms."""

import csv
import io
import json
import math
import os
import re
import sqlite3
import uuid
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response as CookieResponse
from fastapi.responses import Response
from pydantic import BaseModel, Field, model_validator
import auth

DB = os.environ.get("DATABASE_PATH", str(Path(__file__).with_name("forms.sqlite3")))
QuestionType = Literal[
    "short_text",
    "long_text",
    "multiple_choice",
    "dropdown",
    "email",
    "number",
    "yes_no",
    "rating",
]


class Question(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    type: QuestionType = "short_text"
    title: str = Field(min_length=1, max_length=1000)
    description: str = Field(default="", max_length=3000)
    required: bool = False
    options: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def choices(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Question titles cannot be blank")
        self.options = [option.strip() for option in self.options]
        if any(len(option) > 1000 for option in self.options):
            raise ValueError("Choices must be at most 1,000 characters")
        if self.type in ("multiple_choice", "dropdown") and (
            not self.options
            or any(not x.strip() for x in self.options)
            or len(set(self.options)) != len(self.options)
        ):
            raise ValueError("Choice questions need unique, non-empty options")
        return self


class FormInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    questions: list[Question] = Field(default_factory=list, max_length=100)
    theme: Literal["paper", "sage", "lavender", "night"] = "paper"
    thank_you: str = Field(
        default="Thanks for sharing. Your response means a lot.", max_length=1000
    )

    @model_validator(mode="after")
    def unique_ids(self):
        self.title = self.title.strip()
        if not self.title:
            raise ValueError("Form titles cannot be blank")
        if len({q.id for q in self.questions}) != len(self.questions):
            raise ValueError("Question IDs must be unique")
        return self


class Submission(BaseModel):
    answers: dict[str, Any]
    version: int = Field(strict=True, ge=1)


@contextmanager
def db():
    connection = sqlite3.connect(DB, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def now():
    return datetime.now(timezone.utc).isoformat()


def get_form(c, fid, owner_id=None):
    row = c.execute("SELECT * FROM forms WHERE id=?", (fid,)).fetchone()
    if row is None or (owner_id is not None and row["owner_id"] != owner_id):
        raise HTTPException(404, "Form not found")
    return row


def serialize(c, row):
    data = dict(row)
    data.pop("published_snapshot")
    data.pop("owner_id", None)
    data["questions"] = [
        json.loads(q["definition"])
        for q in c.execute(
            "SELECT definition FROM questions WHERE form_id=? ORDER BY position",
            (row["id"],),
        )
    ]
    data["response_count"] = c.execute(
        "SELECT COUNT(*) FROM responses WHERE form_id=?", (row["id"],)
    ).fetchone()[0]
    return data


def save_questions(c, fid, questions):
    c.execute("DELETE FROM questions WHERE form_id=?", (fid,))
    c.executemany(
        "INSERT INTO questions(form_id, id, position, definition) VALUES(?,?,?,?)",
        [(fid, q["id"], i, json.dumps(q)) for i, q in enumerate(questions)],
    )


def create(c, data, owner_id=None):
    fid = uuid.uuid4().hex[:12]
    c.execute(
        "INSERT INTO forms(id,title,theme,thank_you,created_at,updated_at) VALUES(?,?,?,?,?,?)",
        (fid, data.title, data.theme, data.thank_you, now(), now()),
    )
    c.execute("UPDATE forms SET owner_id=? WHERE id=?", (owner_id, fid))
    save_questions(c, fid, [q.model_dump() for q in data.questions])
    return serialize(c, get_form(c, fid))


def publish(c, fid, owner_id=None):
    # Serialize publications so concurrent requests cannot reuse a version.
    if not c.in_transaction:
        c.execute("BEGIN IMMEDIATE")
    form = serialize(c, get_form(c, fid, owner_id))
    if not form["questions"]:
        raise HTTPException(422, "Add at least one question before publishing")
    version = form["version"] + 1
    form["version"] = version
    form["status"] = "published"
    form["updated_at"] = now()
    c.execute(
        "UPDATE forms SET status='published', version=?, published_snapshot=?,updated_at=? WHERE id=?",
        (version, json.dumps(form), now(), fid),
    )
    return serialize(c, get_form(c, fid))


def validate(form, answers):
    errors = {}
    known = {q["id"] for q in form["questions"]}
    if set(answers) - known:
        raise HTTPException(422, "Unknown question in submission")
    for q in form["questions"]:
        value = answers.get(q["id"])
        empty = value is None or (isinstance(value, str) and not value.strip())
        if empty:
            if q["required"]:
                errors[q["id"]] = "Please answer this question."
            continue
        kind = q["type"]
        if kind in ("short_text", "long_text", "email") and (
            not isinstance(value, str) or len(value) > 10000
        ):
            errors[q["id"]] = "Enter valid text (up to 10,000 characters)."
        elif kind == "email" and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            errors[q["id"]] = "Enter a valid email address."
        elif kind == "number":
            try:
                if isinstance(value, bool) or not math.isfinite(float(value)):
                    raise ValueError()
            except (ValueError, TypeError):
                errors[q["id"]] = "Enter a valid number."
        elif kind in ("multiple_choice", "dropdown") and value not in q["options"]:
            errors[q["id"]] = "Select one of the available options."
        elif kind == "yes_no" and value not in ("Yes", "No"):
            errors[q["id"]] = "Choose Yes or No."
        elif kind == "rating" and (type(value) is not int or not 1 <= value <= 5):
            errors[q["id"]] = "Choose a rating from 1 to 5."
    if errors:
        raise HTTPException(422, errors)


def initialize():
    Path(DB).parent.mkdir(parents=True, exist_ok=True)
    with db() as c:
        c.execute("PRAGMA journal_mode = WAL")
        c.executescript("""
        CREATE TABLE IF NOT EXISTS forms(id TEXT PRIMARY KEY,title TEXT NOT NULL,theme TEXT NOT NULL,thank_you TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',version INTEGER NOT NULL DEFAULT 0,published_snapshot TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS questions(form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,id TEXT NOT NULL,position INTEGER NOT NULL,definition TEXT NOT NULL,PRIMARY KEY(form_id,id),UNIQUE(form_id,position));
        CREATE TABLE IF NOT EXISTS responses(id TEXT PRIMARY KEY,form_id TEXT NOT NULL REFERENCES forms(id) ON DELETE CASCADE,version INTEGER NOT NULL,submitted_at TEXT NOT NULL,snapshot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS answers(response_id TEXT NOT NULL REFERENCES responses(id) ON DELETE CASCADE,question_id TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(response_id,question_id));
        CREATE TABLE IF NOT EXISTS app_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS responses_form ON responses(form_id,submitted_at);
        """)
        auth.init_auth(c)
        c.execute("BEGIN IMMEDIATE")
        if c.execute("SELECT 1 FROM app_meta WHERE key='seed_initialized'").fetchone():
            return
        # Mark existing installations as initialized without inserting samples again.
        c.execute("INSERT INTO app_meta VALUES('seed_initialized', '1')")
        if c.execute("SELECT COUNT(*) FROM forms").fetchone()[0]:
            return
        seeds = [
            (
                "A little about you",
                "sage",
                [
                    Question(
                        id="name",
                        title="First things first, what’s your name?",
                        required=True,
                    ),
                    Question(
                        id="email",
                        type="email",
                        title="And your email address?",
                        description="Just so we can keep in touch.",
                        required=True,
                    ),
                    Question(
                        id="role",
                        type="multiple_choice",
                        title="What brings you here?",
                        options=["Design", "Engineering", "Product", "Something else"],
                        required=True,
                    ),
                    Question(
                        id="rating",
                        type="rating",
                        title="How was your first impression?",
                        required=True,
                    ),
                    Question(
                        id="notes",
                        type="long_text",
                        title="Anything else you’d like us to know?",
                    ),
                ],
            ),
            (
                "Customer happiness check-in",
                "lavender",
                [
                    Question(
                        id="satisfaction",
                        type="rating",
                        title="How happy are you with your experience?",
                        required=True,
                    ),
                    Question(
                        id="recommend",
                        type="yes_no",
                        title="Would you recommend us to a friend?",
                        required=True,
                    ),
                    Question(
                        id="frequency",
                        type="dropdown",
                        title="How often do you use our product?",
                        options=[
                            "Every day",
                            "A few times a week",
                            "Once a week",
                            "Occasionally",
                        ],
                    ),
                    Question(
                        id="team",
                        type="number",
                        title="How many people are on your team?",
                    ),
                    Question(
                        id="feedback",
                        type="long_text",
                        title="What could we do better?",
                    ),
                ],
            ),
        ]
        for index, (title, theme, questions) in enumerate(seeds):
            f = create(c, FormInput(title=title, theme=theme, questions=questions))
            publish(c, f["id"])
            snapshot = json.loads(get_form(c, f["id"])["published_snapshot"])
            for n in range(6 if index == 0 else 4):
                values = (
                    {
                        "name": ["Alex", "Jordan", "Sam", "Taylor", "Casey", "Morgan"][
                            n
                        ],
                        "email": f"person{n+1}@example.com",
                        "role": ["Design", "Engineering", "Product"][n % 3],
                        "rating": 4 + n % 2,
                        "notes": "Loved the thoughtful experience.",
                    }
                    if index == 0
                    else {
                        "satisfaction": 3 + n % 3,
                        "recommend": "Yes" if n % 3 else "No",
                        "frequency": "Every day",
                        "team": n + 2,
                        "feedback": "More useful templates, please.",
                    }
                )
                store(c, f["id"], snapshot, values)
        create(
            c,
            FormInput(
                title="Your next big idea",
                questions=[Question(title="Tell us about your idea", type="long_text")],
            ),
        )


def store(c, fid, snapshot, answers):
    rid = uuid.uuid4().hex
    c.execute(
        "INSERT INTO responses VALUES(?,?,?,?,?)",
        (rid, fid, snapshot["version"], now(), json.dumps(snapshot)),
    )
    c.executemany(
        "INSERT INTO answers VALUES(?,?,?)",
        [(rid, key, json.dumps(value)) for key, value in answers.items()],
    )
    return {"id": rid}


@asynccontextmanager
async def lifespan(app):
    initialize()
    yield


app = FastAPI(title="iLoveForms API", lifespan=lifespan)


def current_creator(request: Request, response: CookieResponse):
    with db() as c:
        return auth.resolve(c, request, response)


@app.get("/api/auth/session")
def session(creator: auth.Creator = Depends(current_creator)):
    return creator.profile()


@app.post("/api/auth/register", status_code=201)
def register(data: auth.Registration, request: Request, response: CookieResponse):
    with db() as c:
        return auth.register(c, request, response, data)


@app.post("/api/auth/login")
def login(data: auth.Credentials, request: Request, response: CookieResponse):
    with db() as c:
        return auth.login(c, request, response, data)


@app.post("/api/auth/logout")
def logout(request: Request, response: CookieResponse):
    with db() as c:
        auth.revoke(c, request)
        response.headers["Cache-Control"] = "no-store"
        return auth.guest(c, response).profile()


@app.get("/api/health")
def health():
    try:
        with db() as c:
            c.execute("SELECT id FROM forms LIMIT 1").fetchone()
    except sqlite3.Error:
        raise HTTPException(503, "Database unavailable")
    return {"status": "ok"}


@app.get("/api/forms")
def forms(creator: auth.Creator = Depends(current_creator)):
    with db() as c:
        return [
            serialize(c, row)
            for row in c.execute("SELECT * FROM forms WHERE owner_id=? ORDER BY created_at DESC", (creator.id,))
        ]


@app.post("/api/forms", status_code=201)
def new_form(data: FormInput, creator: auth.Creator = Depends(current_creator)):
    with db() as c:
        return create(c, data, creator.id)


@app.get("/api/forms/{fid}")
def read_form(fid: str, creator: auth.Creator = Depends(current_creator)):
    with db() as c:
        return serialize(c, get_form(c, fid, creator.id))


@app.put("/api/forms/{fid}")
def update_form(fid: str, data: FormInput, creator: auth.Creator = Depends(current_creator)):
    with db() as c:
        get_form(c, fid, creator.id)
        c.execute(
            "UPDATE forms SET title=?,theme=?,thank_you=?,updated_at=? WHERE id=?",
            (data.title, data.theme, data.thank_you, now(), fid),
        )
        save_questions(c, fid, [q.model_dump() for q in data.questions])
        return serialize(c, get_form(c, fid, creator.id))


@app.delete("/api/forms/{fid}", status_code=204)
def delete_form(fid: str, creator: auth.Creator = Depends(current_creator)):
    with db() as c:
        get_form(c, fid, creator.id)
        c.execute("DELETE FROM forms WHERE id=?", (fid,))


@app.post("/api/forms/{fid}/duplicate", status_code=201)
def duplicate(fid: str, creator: auth.Creator = Depends(current_creator)):
    with db() as c:
        form = serialize(c, get_form(c, fid, creator.id))
        form["title"] = form["title"][:193] + " (copy)"
        return create(c, FormInput(**form), creator.id)


@app.post("/api/forms/{fid}/publish")
def publish_form(fid: str, creator: auth.Creator = Depends(current_creator)):
    with db() as c:
        get_form(c, fid, creator.id)
        return publish(c, fid, creator.id)


@app.post("/api/forms/{fid}/unpublish")
def unpublish(fid: str, creator: auth.Creator = Depends(current_creator)):
    with db() as c:
        get_form(c, fid, creator.id)
        c.execute("UPDATE forms SET status='draft' WHERE id=?", (fid,))
        return serialize(c, get_form(c, fid, creator.id))


@app.get("/api/public/{fid}")
def public(fid: str):
    with db() as c:
        row = get_form(c, fid)
        if row["status"] != "published":
            raise HTTPException(404, "This form is not accepting responses.")
        return json.loads(row["published_snapshot"])


@app.post("/api/public/{fid}/responses", status_code=201)
def submit(fid: str, data: Submission):
    with db() as c:
        # Keep publication/version checks and insertion in the same write transaction.
        c.execute("BEGIN IMMEDIATE")
        row = get_form(c, fid)
        if row["status"] != "published":
            raise HTTPException(404, "This form is not accepting responses.")
        form = json.loads(row["published_snapshot"])
        if form["version"] != data.version:
            raise HTTPException(
                409, "This form was updated. Please refresh and start again."
            )
        validate(form, data.answers)
        return store(c, fid, form, data.answers)


@app.get("/api/forms/{fid}/responses")
def responses(fid: str, creator: auth.Creator = Depends(current_creator)):
    with db() as c:
        get_form(c, fid, creator.id)
        result = []
        for row in c.execute(
            "SELECT * FROM responses WHERE form_id=? ORDER BY submitted_at DESC", (fid,)
        ):
            item = dict(row)
            item["snapshot"] = json.loads(item["snapshot"])
            item["answers"] = {
                a["question_id"]: json.loads(a["value"])
                for a in c.execute(
                    "SELECT * FROM answers WHERE response_id=?", (row["id"],)
                )
            }
            result.append(item)
        return result


@app.get("/api/forms/{fid}/export")
def export(fid: str, creator: auth.Creator = Depends(current_creator)):
    items = responses(fid, creator)
    columns = {}
    for item in items:
        for q in item["snapshot"]["questions"]:
            columns[q["id"]] = q["title"]
    output = io.StringIO()
    writer = csv.writer(output)

    def safe(value):
        value = str(value)
        return (
            "'" + value
            if value.lstrip().startswith(("=", "+", "-", "@"))
            or value.startswith(("\t", "\r"))
            else value
        )

    writer.writerow(["Submitted at", *[safe(title) for title in columns.values()]])
    for item in items:
        writer.writerow(
            [item["submitted_at"], *[safe(item["answers"].get(q, "")) for q in columns]]
        )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="responses.csv"', "Cache-Control": "no-store"},
    )

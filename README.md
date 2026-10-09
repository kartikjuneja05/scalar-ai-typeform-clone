# iLoveForms — Typeform builder

A full-stack assignment implementation of the supplied Typeform assignment. Next.js + TypeScript frontend, FastAPI backend, and SQLite persistence. The interface follows Typeform's workspace, content/design builder, share, and results workflows with a restrained paper/sage palette.

## Run locally

Requires Node.js 22 and Python 3.14 (the deployment/test versions).

Terminal 1:

```sh
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

Terminal 2:

```sh
cd frontend
npm ci
npm run dev
```

Open http://localhost:3000. The API seeds two published forms, ten responses, and one draft on an empty database. SQLite is created at `backend/forms.sqlite3`; set `DATABASE_PATH` to override. The initial profile is guest. Guests can build forms in their browser workspace; registration and sign-in preserve those forms under an account. Public links are `/f/<form-id>` and need no login.

## Hosting

Follow [HOSTING.md](HOSTING.md) for GitHub setup, a Render backend with persistent SQLite storage, and a Vercel frontend. `render.yaml` supplies the optional backend Blueprint. Personal workflow explanation documents in `docs/` and all Word/PDF files are ignored by Git and remain local.

## Included

- Account creation, sign-in, sign-out and browser-scoped guest workspaces. Public respondents never need an account.

- Form list with search, status filters, grid/list views, counts, create, rename, duplicate, and confirmed delete.
- Three-panel builder: editable titles/help text, all eight question types, required settings, choice editing, native drag-and-drop, accessible move buttons, duplicate/delete questions.
- Interactive full-screen preview, four themes, and configurable thank-you copy.
- Explicit Save and Publish, versioned publication snapshots, unpublish, and copyable public links.
- One-question-at-a-time respondent flow with transitions, Enter/arrow navigation, progress, client/server validation, and thank-you screen. Ctrl+Enter advances long text; plain Enter adds a newline.
- Persistent responses, full response details, choice/rating count summaries, CSV export with spreadsheet formula escaping.
- Placeholder logic, integrations, account settings, and collaboration.

## Architecture

`frontend/app/page.tsx` owns the workspace and editor. `components/Flow.tsx` is shared by public form pages and previews, and `components/model.ts` defines shared frontend types and API helpers. The Next.js rewrite forwards `/api/*` to FastAPI, keeping browser requests same-origin. Set `API_URL` on the frontend server to point to a deployed backend.

FastAPI validates incoming form definitions with Pydantic and respondent answers against the published version. Database transactions keep form/question writes and submissions atomic. SQLite uses WAL mode; publishing and submissions take a write lock before checking/updating the version. Use one backend instance for the disk-backed deployment. Published snapshots stay separate from editable definitions; republishing increments a version. Submissions against an obsolete version return 409 instead of being silently validated against changed questions. Historical submissions retain their question wording.

## Database schema

| Table       | Purpose and relationships                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `forms`     | Form ID, title, theme, thank-you copy, draft/published status, version, publication snapshot, timestamps.                                                                                                         |
| `questions` | Ordered editable definitions; composite primary key `(form_id, id)`, unique `(form_id, position)`, cascade foreign key to forms. Type-specific configuration is JSON.                                             |
| `responses` | Submission ID, form foreign key, published version, UTC timestamp, immutable submitted definition snapshot. Indexed by form and submission time.                                                                  |
| `app_meta`  | Initialization marker so deleting all forms does not cause samples to be inserted again after restarting.                                                                                                         |
| `answers`   | One JSON value per response/question; composite primary key `(response_id, question_id)`, cascade foreign key to responses. Question IDs refer to the immutable response snapshot rather than mutable draft rows. |

Deleting a form cascades questions, responses, and answers. Duplicating creates a new draft without copying responses. SQLite connections enable foreign-key enforcement.

## API overview

Interactive API docs: http://localhost:8000/docs.

| Method         | Endpoint                     | Purpose                                         |
| -------------- | ---------------------------- | ----------------------------------------------- |
| GET/POST       | `/api/forms`                 | List/create forms                               |
| GET/PUT/DELETE | `/api/forms/{id}`            | Read/save/delete definition                     |
| POST           | `/api/forms/{id}/duplicate`  | Duplicate into a new draft                      |
| POST           | `/api/forms/{id}/publish`    | Publish a versioned snapshot                    |
| POST           | `/api/forms/{id}/unpublish`  | Stop accepting public responses                 |
| GET            | `/api/public/{id}`           | Read published definition                       |
| POST           | `/api/public/{id}/responses` | Validate and submit `{answers, version}`        |
| GET            | `/api/forms/{id}/responses`  | Responses with immutable definition and answers |
| GET            | `/api/forms/{id}/export`     | Download CSV                                    |
| GET            | `/api/health`                | Readiness check                                 |

## Checks

```sh
cd backend
pip install -r requirements-dev.txt
.venv/bin/python -m unittest discover -s tests -v
cd ../frontend
npm run typecheck
npm run build
```

## Assumptions and limits

The app starts with a guest profile. Each browser receives an opaque HttpOnly session cookie and owns its workspace. Registration upgrades a guest while keeping forms; signing in imports that browser’s guest forms into the account. Creator endpoints enforce ownership. Public form filling needs no login. Guest access lasts up to 30 days and depends on retaining the cookie; create an account for access across browsers. Email verification, password reset and login abuse limits remain future work.

All eight question types, form CRUD, publication, preview, required/email/number/choice validation, completed responses, historical response details, summaries and CSV export are implemented. Logic jumps, integrations, real team collaboration, file uploads, payments and AI generation remain placeholders or future work. Unfinished answers are kept in browser memory. Saving is explicit, and leaving the editor saves pending changes. Concurrent creator edits can overwrite each other; there is no submission idempotency or result pagination. Summaries aggregate by question ID across versions.

Use a persistent disk for SQLite. The application initializes new tables at startup but has no general migration framework. `backend/backup_db.py` creates consistent SQLite backups. API health checks verify database access. The included GitHub Actions workflow runs seventeen API regression tests, frontend type checking and the production build. Comprehensive browser automation and modal focus trapping remain future polish.

This workspace has not been pushed to GitHub or deployed by the assistant. The instructions and hosting configuration are prepared for your deployment.

Design reference: [Typeform's official first-form guide](https://help.typeform.com/hc/en-us/articles/360053660271-My-first-form). Original implementation; no source code copied from existing clone repositories.

## Creator sessions

`backend/auth.py` hashes passwords with salted PBKDF2-HMAC-SHA256 (600,000 iterations) and stores only token digests for 30-day sessions. Cookies are HttpOnly and SameSite=Lax; set `COOKIE_SECURE=true` on HTTPS hosting. The frontend establishes its session before loading forms and keeps API requests same-origin through Next.js. Public form endpoints do not create or require a session. Existing databases gain creator/session tables and a form owner column without deleting data; the first guest to open the installation receives legacy unowned forms. Personal explanation files remain excluded from Git.

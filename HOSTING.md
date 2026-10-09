# Hosting iLoveForms

Use Vercel for Next.js and Render for FastAPI. Keep SQLite on a persistent disk attached to the backend. The browser uses the Vercel URL for both the workspace and public forms; Next.js proxies `/api/*` to Render.

Creators can register or sign in, or use the default guest profile. Workspaces and results are restricted to their owner. Published forms remain open without sign-in. Guest forms depend on this browser retaining its session cookie; registration keeps them under an account. Email verification, password reset and abuse limits remain future improvements.

## 1. Put source code on GitHub

Create an empty public repository named `iloveforms` on GitHub. Do not initialize it with a README because this project already has one. From the project folder:

```sh
cd /path/to/your/project
git init -b main
git add .
git diff --cached --name-only
```

Review the file list. It should include `frontend/`, `backend/`, `.github/`, `render.yaml`, `README.md`, `HOSTING.md`, and `.gitignore`. The explanation document stays local: `.gitignore` excludes `/docs/`, all `.docx` and `.pdf` files, databases, secrets, virtual environments, and installed/build dependencies.

Confirm that no explanation documents are staged:

```sh
git ls-files docs '*.docx' '*.pdf'
```

This must print nothing. Then commit and connect the empty repository, replacing `YOUR_USERNAME` with your GitHub username:

```sh
git commit -m "Complete iLoveForms assignment"
git remote add origin https://github.com/YOUR_USERNAME/iloveforms.git
git push -u origin main
```

The project is not currently pushed by this assistant. These are the steps for you to run. Never use `git add -f docs` because it overrides the ignore rules. If a document is already tracked in a different repository, `.gitignore` will not remove it from history; untrack it before pushing.

## 2. Deploy the backend on Render

The included `render.yaml` is an optional Blueprint. You can import it as a Blueprint or create a Web Service manually. Use one method, not both.

**Cost:** this setup uses paid Render compute and a persistent disk. Free compute has no persistent disk for this SQLite setup. Confirm the current price in the Render dashboard before creating the service. [Render disk documentation](https://render.com/docs/disks).

For manual setup, connect the GitHub repository and use:

| Setting                | Value                                                             |
| ---------------------- | ----------------------------------------------------------------- |
| Runtime                | Python                                                            |
| Root Directory         | `backend`                                                         |
| Build Command          | `pip install -r requirements.txt`                                 |
| Start Command          | `uvicorn main:app --host 0.0.0.0 --port $PORT --workers 1`        |
| Health Check Path      | `/api/health`                                                     |
| Instance               | A paid instance with an attached disk; the Blueprint uses Starter |
| Disk mount path        | `/var/data`                                                       |
| Disk size              | `1 GB` initially                                                  |
| Environment variable   | `DATABASE_PATH=/var/data/forms.sqlite3`                           |
| Secure session cookies | `COOKIE_SECURE=true` (hosted HTTPS only)                          |
| Python version         | The included `.python-version` requests Python 3.14               |

The root directory determines where build and start commands run. The disk is available at runtime; do not initialize the database in a build/predeploy command. FastAPI initializes it at startup, seeds samples once, and preserves later data. The disk-backed backend should stay at one instance. [Render monorepo documentation](https://render.com/docs/monorepo-support).

After deployment, copy the actual `https://…onrender.com` URL shown by Render. Open its `/api/health` path and confirm `{"status":"ok"}`. `/docs` exposes the API reference. The Blueprint waits for GitHub checks before automatic updates; the initial deployment is initiated by Render when creating the service.

## 3. Deploy the frontend on Vercel

Import the same GitHub repository as a new Vercel project:

| Setting              | Value                                              |
| -------------------- | -------------------------------------------------- |
| Framework            | Next.js                                            |
| Root Directory       | `frontend`                                         |
| Node.js              | `22.x`                                             |
| Install Command      | `npm ci`                                           |
| Build Command        | `npm run build`                                    |
| Output Directory     | Leave the Next.js default                          |
| Environment variable | `API_URL=https://YOUR_ACTUAL_BACKEND.onrender.com` |

Use the actual Render URL, without `/api`. Set `API_URL` for Production and Preview before deploying. This value is read by `next.config.ts` to build the proxy rewrites; redeploy Vercel after changing it. There is no `NEXT_PUBLIC_API_URL` variable. Browser requests stay on the frontend origin, so this proxy arrangement needs no extra CORS configuration. [Vercel environment variable documentation](https://vercel.com/docs/environment-variables), [Vercel monorepo documentation](https://vercel.com/docs/monorepos).

The Vercel domain is your demo link. Publishing a form produces `/f/<id>` links on that domain. A form can be filled without a creator account. If your Vercel deployment has protection enabled, ensure the intended evaluator/respondents can access it; use the intended public production URL for submission.

## 4. Verify the hosted application

1. Open `https://YOUR_FRONTEND/api/health` and confirm the backend is reachable through the proxy.
2. Check the seeded forms and response counts.
3. Create a form as guest, register an account and confirm the form remains, then save and publish it.
4. Copy its public URL into a separate/private browser window and submit a response.
5. Open Results, inspect the full response and download CSV.
6. Change a draft and confirm the public definition changes only after republishing.
7. Sign out and confirm the profile is guest and account forms are hidden; sign in and confirm they return.
8. Redeploy/restart the backend and confirm that your saved form and response remain. This is the essential persistent-disk check.

If forms do not load, check Render health, `API_URL`, and Vercel deployment logs. If data disappears, check that `DATABASE_PATH` is inside the disk mount, not inside the source directory. A missing public form can mean it was unpublished. After a 409 version error, reload the form to use its latest publication.

## 5. Back up data and maintain the deployment

Use SQLite's backup API instead of copying only the database file while WAL writes may be active. In the Render shell, run:

```sh
python backup_db.py /var/data/backups/forms-backup.sqlite3
```

Download backups to separate storage; a backup on the same disk is not protection against disk loss. Test restoring into a separate instance before relying on a backup. [Render disk and file transfer documentation](https://render.com/docs/disks).

The GitHub workflow runs the frontend type check/build and backend regression tests. Updates through GitHub can trigger the hosting providers' deployments. Persistent-disk Render deploys may briefly interrupt the backend. The app has no automatic database migration framework; schema changes need a reviewed migration and backup.

For a larger production service, add email verification, password reset, abuse prevention, submission idempotency, pagination, and retention controls. Multiple backend instances would require a shared database rather than this single-instance SQLite deployment.

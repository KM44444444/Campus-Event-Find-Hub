# Campus Event & Find Hub — Group 16

A full-stack app for campus event management and a lost-and-found board.
The frontend (`frontend/index.html`) now calls the real backend
(`backend/server.js`) over HTTP — the two halves are wired together and
this is what actually runs, not a demo.

## Features

- **Admin**: log in, approve pending student registrations, upload events (with optional image).
- **Student**: register (pending admin approval), log in, view events, report a lost or found item with an optional photo.
- **Everyone (once logged in)**: browse the event list and the lost & found board.
- Passwords are hashed with bcrypt and stored in SQLite — never in the browser.
- Sessions use a JWT stored in `sessionStorage` (cleared when the tab closes), not hardcoded credentials.
- Forgot-password uses a real OTP: the backend generates it, emails it via Nodemailer if SMTP is configured, and otherwise prints it to the backend console so you can still test the flow without email set up.

## Tech Stack

- **Frontend**: plain HTML/CSS/JS, calling the backend via `fetch`.
- **Backend**: Node.js + Express, SQLite3, JWT auth, bcrypt password hashing, Multer for image uploads, Nodemailer for OTP email.

## Setup

### 1. Backend
```bash
cd backend
npm install
```

Create `backend/.env`:
```
PORT=4000
JWT_SECRET=change_me_to_something_random
OTP_EXPIRY_SECONDS=900
# Optional — without these, OTPs are logged to the server console instead of emailed
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
```

Start it:
```bash
npm start
```

You should see:
```
SQLite connected: .../db.sqlite
✅ Admin seeded: kshitiz.mandola.cseds.2024@miet.ac.in
✅ Server running on port 4000
```

### 2. Frontend
The frontend is a static file that talks to `http://localhost:4000` (see the
`API_BASE` constant near the top of the `<script>` in `index.html` — change
it if your backend runs elsewhere). Serve it with any static server, e.g.:
```bash
cd frontend
npx http-server -p 3000
```
Then open http://localhost:3000. Opening `index.html` directly by
double-clicking it also works, since it makes cross-origin requests to the
backend rather than needing to be served from the same origin.

### Deploy the backend to Vercel

Create a Vercel project with the repository's **Root Directory** set to
`backend`. The Express app is exported for Vercel, and runtime SQLite and
upload files are placed under `/tmp` because the deployed application bundle
is read-only. Set `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in the
Vercel project's Environment Variables before deploying. After deployment,
open the backend URL to confirm it returns `Campus Hub Backend Running`.

Vercel's `/tmp` storage is temporary and may be reset or differ between
function instances. This setup is suitable for previewing the app, but data
and uploaded images are not durable across deployments or instances. For a
production deployment, use a hosted persistent database and object storage.
The frontend's `API_BASE` in `frontend/index.html` must also be set to the
deployed backend URL (without a trailing slash) before deploying the frontend.

## Default Admin Login
- Email: `kshitiz.mandola.cseds.2024@miet.ac.in`
- Password: `12345678`

Change these by setting `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `backend/.env`
before the first run (the admin account is only seeded once, on first
startup, if it doesn't already exist).

## API Endpoints (actual, matches server.js)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/student/register` | – | `{ email, password }`, password ≥ 6 chars |
| POST | `/api/student/login` | – | Requires prior admin approval |
| POST | `/api/admin/login` | – | |
| GET | `/api/admin/pending` | admin | List unapproved students |
| POST | `/api/admin/approve` | admin | `{ email }` |
| POST | `/api/event/upload` | admin | multipart: `title`, `description`, optional `photo` |
| GET | `/api/events/all` | – | |
| POST | `/api/upload/lost` | student/admin | multipart: `name`, `description`, optional `photo` |
| POST | `/api/upload/found` | student/admin | multipart: `name`, `description`, optional `photo` |
| GET | `/api/items/all` | – | Lost + found items, `type` field distinguishes them |
| POST | `/api/otp/request` | – | `{ email }` — emails or logs a 6-digit OTP |
| POST | `/api/otp/reset` | – | `{ email, otp, newPassword }` |

## Database Schema (actual)

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE, password TEXT, role TEXT DEFAULT 'student',
  approved INTEGER DEFAULT 0, created_at INTEGER
);

CREATE TABLE otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT, otp TEXT, expires_at INTEGER
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, description TEXT, photo TEXT, posted_by TEXT, created_at INTEGER
);

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT, -- 'lost' | 'found'
  name TEXT, description TEXT, photo TEXT, posted_by TEXT, created_at INTEGER
);
```

## Known Limitations (honest, not aspirational)

- No event edit/delete endpoints yet.
- CORS is wide open (`cors()` with no origin restriction) — fine for local dev, tighten before any real deployment.
- SQLite is fine for a class project; migrate to Postgres/MySQL for anything with concurrent multi-instance writes.
- `uploads/` grows unbounded — no cleanup job.

## License
Educational project — Group 16.

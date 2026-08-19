# Guild War Roster Manager

A real-time web application for managing guild war rosters. Built for LAN guild teams to plan group compositions, manage reserves, and track registrations across battle days.

## Features

- **Group Management** — Create, rename, and delete groups with drag-and-drop player placement
- **Reserves & Registration** — Public self-registration form; reserves can be moved to groups or guild members
- **Guild Member List** — Master list of all registered players (CSV import/export)
- **Real-time Sync** — Multiple editors see each other's changes via SSE + polling
- **Concurrency Merge** — Stale snapshots are merged intelligently; no lost edits
- **Export** — Print/PDF roster, image export, guild member CSV
- **History** — Track all changes with timestamps
- **Roles & Permissions** — SuperAdmin, Admin, Mod, and Public viewer roles
- **Themes** — Dark/Light mode toggle

## Stack

- **Frontend:** Vanilla HTML/CSS/JS (no frameworks)
- **Backend:** Node.js + Express
- **Storage:** JSON file (default) or Supabase (configurable via env)
- **Auth:** bcrypt password hashing, session tokens

## Setup

```bash
# Install dependencies
npm install

# Start with JSON file storage (default)
npm start

# Or start with Supabase storage
STORAGE=supabase SUPABASE_URL=https://xxx.supabase.co SUPABASE_KEY=your-key npm start
```

Copy `.env.example` to `.env` and fill in your values. Open http://localhost:3000 in your browser.

## Default Login

- **Username:** SuperAdmin
- **Password:** Admin123

Change the password after first login via Admin Tools.

## Project Structure

```
wwm-gvgroster/
├── app/                    # Application source
│   ├── index.html          # Single-page app
│   ├── server.js           # Express server entry point
│   ├── js/                 # Client modules
│   ├── css/                # Stylesheets
│   ├── server/             # Server modules
│   │   ├── auth.js         # Sessions, bcrypt, auth config
│   │   ├── merge.js        # Concurrency merge engine
│   │   ├── sse.js          # Server-sent events
│   │   ├── storage/        # Pluggable storage backend
│   │   │   ├── index.js    # Selects backend via STORAGE env var
│   │   │   ├── json/       # JSON file storage (default)
│   │   │   └── supabase/   # Supabase/Postgres storage
│   │   └── route/          # API route handlers
│   ├── config/             # Auth config (git-ignored, created at boot)
│   ├── data/               # Database files (git-ignored, created at boot)
│   ├── test/               # Server-side tests
│   └── vendor/             # Vendored Font Awesome + fonts
├── package.json
├── .env.example            # Environment variable template
├── .gitignore
├── LICENSE
└── README.md
```

## License

[MIT](LICENSE)

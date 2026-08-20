# Supabase Setup Guide

This guide walks you through setting up Supabase as the database backend for the Guild War Management System.

## Prerequisites

1. A [Supabase](https://supabase.com) account (free tier works)
2. A Supabase project created

## Step 1: Get Your Credentials

1. Go to your Supabase project dashboard
2. Click **Settings** (gear icon) → **API**
3. Copy these two values:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key** (starts with `eyJ...`)

## Step 2: Create Tables

1. In your Supabase dashboard, click **SQL Editor** in the left sidebar
2. Click **New Query**
3. Paste the entire SQL below
4. Click **Run** (or press Ctrl+Enter)

> **Note:** When prompted about RLS (Row Level Security), choose **"Run without RLS"**. The app handles authentication itself.

### SQL Script

```sql
-- ============================================
-- Guild War Management System - Supabase Setup
-- ============================================

-- Table 1: app_state (stores roster + auth config)
CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Table 2: history (change log)
CREATE TABLE IF NOT EXISTS history (
  id TEXT PRIMARY KEY,
  timestamp TEXT,
  action TEXT,
  "playerId" TEXT,
  "playerName" TEXT,
  "from" TEXT,
  "to" TEXT,
  day TEXT,
  field TEXT,
  "oldValue" TEXT,
  "newValue" TEXT,
  details TEXT,
  "user" TEXT DEFAULT 'system'
);

-- Seed: Default roster data
INSERT INTO app_state (id, value) VALUES ('main', '{
  "guildName": "Guild Name",
  "groups": {
    "sat": {
      "offence1": {"title": "Offense 1", "players": []},
      "offence2": {"title": "Offense 2", "players": []},
      "defence1": {"title": "Defense", "players": []},
      "jungle": {"title": "Jungle", "players": []}
    },
    "sun": {
      "offence1": {"title": "Offense 1", "players": []},
      "offence2": {"title": "Offense 2", "players": []},
      "defence1": {"title": "Defense", "players": []},
      "jungle": {"title": "Jungle", "players": []}
    }
  },
  "reserves": {"sat": [], "sun": []},
  "guildMembers": [],
  "lastUpdateTime": "2026-08-20T00:00:00.000Z",
  "announcement": {"text": "Welcome to Guild War!", "author": "", "timestamp": ""}
}'::jsonb)
ON CONFLICT (id) DO NOTHING;

-- Seed: Default auth config (password is empty, auto-hashed on first boot)
INSERT INTO app_state (id, value) VALUES ('auth', '{
  "admin": {
    "id": "admin_001",
    "username": "SuperAdmin",
    "password": "",
    "role": "superadmin"
  },
  "moderators": [],
  "settings": {
    "allowModeratorRegistration": true,
    "maxGroups": 6,
    "defaultModPassword": "Admin123",
    "discordWebhook": "",
    "historyLimit": 100
  }
}'::jsonb)
ON CONFLICT (id) DO NOTHING;
```

## Step 3: Verify

After running the SQL, go to **Table Editor** in Supabase. You should see:
- `app_state` table with 2 rows (main + auth)
- `history` table (empty)

## Step 4: Configure .env

Copy the credentials from Step 1 into your `.env` file:

```bash
STORAGE=supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-anon-key-here
```

## Default Credentials

| Account | Username | Password |
|---------|----------|----------|
| SuperAdmin | `SuperAdmin` | `Admin123` |

> The password is auto-hashed on first boot. Changing the SuperAdmin password is permanent — it persists across server restarts.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Invalid credentials" | Make sure password is `Admin123` (capital A). Try Ctrl+Shift+R to clear browser cache. |
| "Database error" | Check that tables exist in Supabase Table Editor. |
| "Auth config error" | Verify `SUPABASE_URL` and `SUPABASE_KEY` are correct in `.env`. |

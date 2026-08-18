# WebImplementationPlan.md

## Project: Mask Sinners Guild War Management
**Current Date:** 2026-08-18
**Status:** Phase 7 Complete (Context Menu + Keyboard Actions). Next up: Phase 8 - Export & Data Portability
**Repo:** git (branch `main`) - `data/` and `config/auth.json` are git-ignored

---

## STACK & RUN

```
Node.js + Express (server.js) | vanilla JS front-end (no framework) | JSON file storage
npm start      ->  node server.js   (default port 3000)
npm run dev    ->  nodemon server.js
Dependencies: express, cors, bcrypt (installed, NOT yet used - see Phase 11)
```

---

## COMPLETED PHASES

### Phase 1: Core System
- [x] Unique ID system (timestamp-based IDs for all players)
- [x] Toast notifications
- [x] CSS variables + themes (dark/light toggle)
- [x] Sticky header + day tabs
- [x] Theme toggle button

### Phase 2: Bulk Actions & Cards
- [x] Bulk selection (checkboxes across groups)
- [x] Copy to Reserve (keep in guild, add to reserves) - Moderators+
- [x] Bulk delete (Admin only, removes from ALL sources)
- [x] Guild member cards (grid layout)
- [x] Player notes (140 char limit, hover tooltip)
- [x] Card editing (name, class, role)
- [x] Drag & drop for guild cards

### Phase 3: History & Shortcuts
- [x] History panel (recent changes), FIFO cleanup (last 100)
- [x] History logging (moves, edits, adds, deletes, bulk)
- [x] Clear history button
- [x] Shortcuts: `?` / `Ctrl+/` legend, `Ctrl+S` save, `Ctrl+T` theme, `Escape` cancel
- [x] Reserve -> Reserve duplicate blocking

### Phase 3.5: Master List Fix
- [x] `guildMembers` is the master list of ALL players
- [x] Registration adds to `guildMembers` + `reserves`
- [x] Server-side migration to populate guildMembers from existing data
- [x] Bulk Copy to Reserve (keep in guild, add to reserves)
- [x] Bulk Delete removes from ALL sources (Admin only)

### Phase 4: Session Auth & Security Hardening
- [x] Session tokens (mod/admin login), `requireAuth` on all mutating endpoints
- [x] `POST /api/data` AUTH-REQUIRED; public writes go through dedicated `POST /api/register` (validates name/class/days, forces role Member, dedupes, logs history server-side)
- [x] `render()` no longer calls `saveState()` (previously a public visitor's stale data clobbered the roster)
- [x] Stored-XSS fix: `esc()` helper at every `innerHTML` injection point; server rejects `<`/`>` in registration names
- [x] Change-password flow (Current Password field, auto-opens after mod login, sends auth header)
- [x] Mod management: `window.moderators` populated from `/api/moderators/list` (Reset PW / Demote work)
- [x] Empty/invalid POST body rejected (400) - cannot wipe roster
- [x] Undo/redo feature removed (module + shortcuts + call sites)

### Phase 5: Multi-Editor Concurrency - Merge + Tombstones + Realtime Sync
- [x] **Server-side merge** (`mergeDatabase`): stale whole-file saves merged by player id - ids the saving client knows win, ids only other editors created survive
- [x] **One-group-per-day constraint** in merge (incoming placement wins on conflicts)
- [x] **Tombstones** (`deletedIds` + in-memory `DELETED_PLAYERS` map): full deletes recorded so a stale copy cannot resurrect a deleted player; auto-pruned (1-week TTL, 500 cap)
- [x] **Explicit removals** (`removed` payload) applied after merge - moves/list-removals stick even on stale saves
- [x] **SSE push** (`GET /api/events`): every save broadcasts `update`; clients re-sync in <1s; 30s poller + `visibilitychange` re-sync remain as fallback
- [x] Client tracks pending removals/deletes (`trackPlayerRemovals` / `trackDeletedPlayerIds`) at every mutation site and clears them after a successful save
- [x] `saveState()` sends `baseVersion` + `deletedIds` + `removed`, then converges to the merged server state

---

## CURRENT BEHAVIOR (source of truth)

### Data model
| Concept | Description |
|---------|-------------|
| **guildMembers** | Master list of ALL players, day-specific: `{ sat: [], sun: [] }` |
| **groups** | Players assigned to groups: `{ sat: { offence1: {title, players: []}, ... } }` |
| **reserves** | `{ sat: [], sun: [] }` |
| **versioning** | `lastUpdateTime` (ISO string) is the write version; client sends `baseVersion` |
| **tombstones** | `deletedIds` in POST payload; `DELETED_PLAYERS` map server-side (in-memory) |

### Rules
| Action | guildMembers (Master) | groups | reserves |
|--------|----------------------|--------|----------|
| **Register** | ADD | no | ADD |
| **Copy to Reserve** | KEEP | KEEP | ADD |
| **Move to Group** | KEEP | ADD | REMOVE (if moving from reserve) |
| **Move to Reserve** | KEEP | REMOVE (if moving from group) | ADD |
| **Delete** | REMOVE | REMOVE | REMOVE |

### Permissions
| Role | Copy to Reserve | Delete (anywhere) | Edit cards |
|------|----------------|-------------------|-----------|
| **Admin** | yes | yes | yes |
| **Moderator** | yes | no (full delete) | yes |
| **Public** | no | no | no |

### Drag & Drop
| Action | Behavior |
|--------|----------|
| Guild -> Group / Reserve | MOVE |
| Reserve -> Guild / Group | MOVE |
| Group -> Guild / Reserve | MOVE |
| Group -> Group | MOVE |
| Reserve -> Reserve | BLOCKED (prevents useless duplicates) |

### Auth & sync
- Mods/admins get a session token; public visitors can only register via `/api/register`
- Every save carries `baseVersion` (last synced server timestamp); server merges if stale
- Clients converge via SSE push, 30s poll, and `visibilitychange` re-sync

---

## API REFERENCE (current)

```
GET  /api/data                        - Load data (public)
POST /api/data                        - Save data (AUTH, merge-aware: baseVersion/deletedIds/removed)
POST /api/register                    - Public self-registration (validated, deduped, logs history)
POST /api/login                       - Authenticate -> session token
POST /api/logout                      - End session
GET  /api/session                     - Check session (auth)
GET  /api/moderators/list             - List moderators (admin)
POST /api/moderators/add              - Add mod (admin)
POST /api/moderators/remove           - Demote mod (admin)
POST /api/moderators/reset-password   - Reset mod password (admin)
POST /api/moderators/change-password  - Change own password (auth)
GET  /api/auth/settings               - Auth settings (admin)
POST /api/auth/settings               - Update auth settings (admin)
GET  /api/events                      - SSE stream (realtime sync push)
POST /api/guild/name                  - Set guild name (auth)
POST /api/groups/add                  - Add group (auth)
POST /api/groups/remove               - Remove group (auth)
GET  /api/groups/config               - Group config (public)
GET  /api/history                     - Get history (public)
POST /api/history                     - Add history entry (public)
POST /api/history/init                - Init history (auth)
GET  /api/backup                      - Download backup (auth)
POST /api/migrate-guild-members       - Migrate master list (admin only)
GET  /api/guild-members-status        - Check migration status
GET  /api/health                      - Health check
```

---

## PENDING PHASES (roadmap)

### Phase 6: Admin Tools & Editing Polish (Completed)
Small UX fixes for admins/mods. **Includes known-bug fixes #1 (Add Group) and #4 (group deletion).**

- [x] **6.1 Fix "Add Group" button** - root cause was TWO bugs: `setupGroupManagement()` was never called in init (no handler attached) AND the `/api/groups/add` fetch sent no auth header (401 after Phase 4.4). Fixed both; group now goes to the currently viewed day (dropdown removed, `window.currentDay` used)
- [x] **6.2 Remove Group button** - trash button on each group card (mods+); confirmation dialog; wired to `/api/groups/remove` with auth header; server blocks non-empty groups ("Move players first.") and the error surfaces as a toast; reloads + logs history after removal
  - Polish: trash repositioned to the card's bottom-right, sitting LEFT of the panel label (flex corner container, no overlap at any width); confirm dialog shows the group's real title
- [x] **6.3 Inline guild name editing** - the old editor referenced input/button elements that don't exist in the HTML (dead code, and the fetch lacked auth). Rebuilt: click the header title (mods+) -> inline input; Enter commits via `/api/guild/name` (auth header); Escape/blur cancels; title updates everywhere
- [x] **6.4 Single-line edit + Enter to commit** - guild card name input now commits on Enter, cancels on Escape (group/reserve badges already had this)
  - Polish: the return-to-reserves arrow is paused (hidden) while a badge is in edit mode so it no longer crowds the save/cancel buttons
- [x] **6.5 Recent changes panel taller** - history list `max-height: 200px` -> `60vh` (scrollable, more entries visible)
- [x] **6.6 Group counter below group grid** - stats row moved below the grid; spacing swapped to `margin-top`; duplicate `id="groupStats"` renamed to `groupCountStats`

### Phase 7: Power-User Interactions ✅ COMPLETE
**Includes known-bug fixes #2 (context menu) and #3 (extended shortcuts) - both FIXED.**

- [x] **7.1 Right-click context menu**
  - New: `js/context-menu.js`, `css/context-menu.css`; wired in `index.html` + `js/main.js` init
  - Options: Copy to Reserve (mods+, hidden for reserve players), Move to Group (flyout submenu with every group of the current day, mods+), Edit Player (mods+, admin-only for guild cards), Delete (admin; reserve delete is mods+ to mirror the existing Delete-Selected rule)
  - Actions reuse the existing flows: copy keeps the player in guild, move removes from source + tracks `trackPlayerRemovals` (stale-merge safe), guild delete is a tombstoned full delete, group/reserve delete is a tracked list removal
  - Menu closes on outside click / Escape / scroll / resize; auto-flips near screen edges; public viewers get no menu (native context menu untouched)
  - Verified E2E in browser: menu items correct per type/permission, all six flows (copy/move reserve/move group/delete group/delete reserve/delete guild) asserted in-memory with correct tracking + tombstone
- [x] **7.2 Extended keyboard shortcuts**
  - Click any player to select (gold highlight), then `C` copy to reserve, `M` move-to-group (menu opens at the player with the submenu already open), `E` edit, `Delete`/`Backspace` delete; Escape or clicking empty space deselects
  - Implemented in `js/context-menu.js` (selection + actions) + `js/shortcuts.js` (keys); legend auto-lists the new keys
  - Note: plan originally put selection in `dragdrop.js`; it lives in `context-menu.js` instead so selection and the actions it drives share one module

### Phase 7B: Roles & Admin Management + UI Usability ✅ COMPLETE
**User-reported: "can't add a new mod/admin"; wanted SuperAdmin above admin, data-driven roles, help legend + collapsible panels.**

- [x] **SuperAdmin role** above Admin - `Tertlaim` is SuperAdmin (stored in `config/auth.json`, git-ignored)
  - Roles are fully data-driven: `server.js` resolves sessions from stored user records (superadmin/admin/mod); no usernames or roles hardcoded in client/server logic (removed the old hardcoded `'Tertlaim'` checks in render.js/main.js)
  - Login, `/api/moderators/*`, `requireAdmin` all role-aware; new `requireSuperAdmin` guards admin management
- [x] **New Mod / New Admin fixed** (the original bug had TWO causes):
  - `/api/moderators/add` fetch had NO auth header -> 401 since Phase 4.4 (now sends `getAuthHeader()`)
  - New Mod button was never enabled: no `change` listener on the player select (added; `updateApproveButton` fires on selection)
  - SuperAdmin-only **New Admin** button (`data-role-show="superadmin"`) creates admins; admins can only add/demote mods (server enforces: 403 otherwise); re-adding existing staff -> 400
  - Demote: admins demote mods; SuperAdmin can also demote admins; the owner can never be demoted
  - Verified E2E: full role matrix via API (add admin/add mod/403 guards), real UI New Mod -> Demote cycle on the live server (account created then removed, auth.json restored)
- [x] **Help & Shortcuts panel** below the Guild panel (collapsible) - keyboard shortcuts grid auto-built from the `Shortcuts` registry + an 8-item Quick Guide (register, drag & drop, right-click menu, keyboard select, bulk, editing, groups, collapsing)
- [x] **Collapsible panels** for all editable panels (A-H + Help): click a panel header to expand/collapse, chevron indicator, state persisted in `localStorage` (`gw_collapsed_panels`), survives reloads
- **Roles storage note:** accounts/roles stay in `config/auth.json` (the git-ignored auth database) rather than `data/database.json` - credentials must not flow through the merge engine or SSE broadcast, which would leak hashed/plaintext passwords to every viewer. Data-driven, versioned out of the repo = not hardcoded.
- [x] **Public-view polish (user-reported bugs):** labels get a reserved bottom strip (2.3rem padding, now `!important` so the later-loaded panel CSS can't override it) so A/B/C/... never overlap content; collapse chevron pinned to the top-right corner of every panel uniformly (was drifting when reserve/guild header buttons wrapped); admin panel's collapse no longer hides its own header (header row is now excluded from the hide rule, so the uncollapse chevron stays visible); panel labels re-lettered to match layout order (Help=E, Register=F, Admin=G, Admin Tools=H, History=I); uniform vertical spacing between panels in the diagram column that mirrors the side panel's gap rhythm at every breakpoint; Help & Shortcuts panel is role-aware - public viewers see only registration/collapse tips + a login hint, mods+ see the full shortcuts grid and guide.

### Phase 8: Export & Data Portability
- [ ] **8.1 Export options** (was plan 4.4)
  - New: `js/export.js`; touch: `index.html`
  - JSON full backup, CSV player list, Image screenshot, PDF printable roster
- [ ] **8.2 Fix backup download**
  - Known issue: `downloadBackup()` uses `window.open` without the auth header -> 401 when wired
  - Acceptance: backup download works for authed users (fetch blob with token + save, or signed URL)

### Phase 9: Mobile & Accessibility
- [ ] **9.1 Mobile optimization** (was plan 4.5)
  - Files: `css/responsive.css`, `index.html`
  - 44px touch targets, swipe day navigation, responsive grids, mobile menu
- [ ] **9.2 Accessibility** (was plan 4.6)
  - Files: `index.html`, `js/main.js`
  - ARIA labels, keyboard navigation, color contrast

### Phase 10: Data Model Simplification
**Includes known-bug fix #5 (guildMembers day-specific).**
- [ ] Change `guildMembers` from `{ sat: [], sun: [] }` to a single array
  - Files: `server.js` (migration endpoint + all readers), `js/*` (getGuildMembers, render, dragdrop, bulk-actions)
  - Acceptance: old data migrates cleanly; no day-splitting anywhere; registration/merge still work

### Phase 11: Security Hardening
Backlog from the adversarial review - none urgent for a private LAN app, but all cheap.
- [ ] **11.1 Hash passwords** - bcrypt is already a dependency but `config/auth.json` stores plaintext; hash on write, verify on login, migrate existing entries
- [ ] **11.2 Rate limiting** on `/api/login` and `/api/register`
- [ ] **11.3 Atomic `writeDatabase`** - write temp file + rename so a crash can't corrupt JSON
- [ ] **11.4 Persist tombstones** in `database.json` (currently in-memory; a restart lets a stale editor resurrect deleted players)
- [ ] **11.5 Sync dirty-check** - skip `applyServerData` while a mod has an in-progress edit (typing/mid-drag) so a poll can't wipe it

### Phase 12: Supabase Migration (To-Do #2)
- [ ] Set up Supabase project + tables (guild_config, groups, reserves, guild_members, history, auth)
- [ ] Add `@supabase/supabase-js`, `.env` with credentials
- [ ] Rewrite `server.js` data layer (fs -> Supabase) keeping the current API contract (merge/tombstones/SSE semantics preserved)
- [ ] Backward-compatible migration of existing `database.json`/`history.json`

### Phase 13: Cron Keep-Alive (To-Do #3) - LAST
- [ ] Weekly ping to keep Supabase instance alive (`cron.js` or node-cron, or external cron-job.org / UptimeRobot)
- [ ] `GET /api/health` already exists - reuse it

---

## PROJECT STRUCTURE (current)

```
guild-war-management/            (git repo, branch main)
├── index.html                   done
├── server.js                    done (auth, merge, tombstones, SSE, register)
├── package.json                 done
├── WebImplementationPlan.md     done (THIS FILE)
├── .gitignore                   done (node_modules, data/, config/auth.json, backups/, .kilo, .freebuff)
├── config/
│   └── auth.json                done (git-ignored, plaintext passwords - Phase 11.1)
├── data/
│   ├── database.json            done (git-ignored)
│   └── history.json             done (git-ignored)
├── css/                         done - 19 files (variables, main, header, day-tabs, toast,
│                                  bulk-actions, guild-cards, shortcuts, diagram,
│                                  admin-view, public-view, reserve, guild-member,
│                                  side-panel, admin-panel, announcement, modal, responsive)
└── js/
    ├── main.js                  done - sync engine (SSE + poll + merge payload)
    ├── api.js                   done - registerPlayer + auth header
    ├── auth-module.js           done - sessions, change-password
    ├── helpers.js               done - esc() + pending removal/delete tracking
    ├── render.js                done - main render
    ├── render-helpers.js        done - guild cards from master list
    ├── event-handlers.js        done - inline edit, checkbox handlers
    ├── dragdrop.js              done - drag & drop
    ├── bulk-actions.js          done - copy/delete/clear selected
    ├── history.js               done - history tracking
    ├── announcement.js          done - announcements
    ├── shortcuts.js             done - ? / Ctrl+S / Ctrl+T / Escape + C/M/E/Delete
    ├── context-menu.js          done - Phase 7: right-click menu + click-to-select
    ├── theme.js                 done - theme management
    ├── toast.js                 done - toast system
    └── data.js                  done - sample/fallback data
    (export.js, cron.js - to be created in Phases 8/13)
```

---

## PROGRESS METRICS

| Phase | Status | Progress |
|-------|--------|----------|
| Phase 1: Core System | done | 100% |
| Phase 2: Bulk Actions & Cards | done | 100% |
| Phase 3: History & Shortcuts | done | 100% |
| Phase 3.5: Master List Fix | done | 100% |
| Phase 4: Session Auth & Security | done | 100% |
| Phase 5: Concurrency (Merge + SSE) | done | 100% |
| Phase 6: Admin Tools & Editing Polish | done | 100% |
| Phase 7: Power-User Interactions | ✅ complete | 100% |
| Phase 7B: Roles, Admin Mgmt & Usability | ✅ complete | 100% |
| Phase 8: Export & Backup | pending | 0% |
| Phase 9: Mobile & Accessibility | pending | 0% |
| Phase 10: Data Model Simplification | pending | 0% |
| Phase 11: Security Hardening | pending | 0% |
| Phase 12: Supabase Migration | pending | 0% |
| Phase 13: Cron Keep-Alive | pending | 0% |

**Overall Progress:** ~94%

---

## KNOWN BUGS -> PHASE MAP

| # | Bug | Where it's fixed |
|---|-----|------------------|
| 1 | Add Group button not working | ✅ Fixed in Phase 6.1 (was never initialized + missing auth header) |
| 2 | No right-click context menu | ✅ Fixed in Phase 7.1 (context-menu.js) |
| 3 | No extended keyboard shortcuts (C/M/E/Delete) | ✅ Fixed in Phase 7.2 (click-to-select + keys) |
| 4 | Group deletion not implemented | ✅ Fixed in Phase 6.2 (remove button + confirmation + non-empty guard) |
| 5 | guildMembers day-specific (should be single array) | Phase 10 |
| 6 | Backup download 401s (window.open without auth header) | Phase 8.2 |
| 7 | `config/auth.json` plaintext passwords (bcrypt unused) | Phase 11.1 |
| 8 | No rate limiting on login/register | Phase 11.2 |
| 9 | Non-atomic writeDatabase (crash can corrupt JSON) | Phase 11.3 |
| 10 | Tombstones in-memory only (lost on restart) | Phase 11.4 |
| 11 | Poll can wipe an in-progress edit (no dirty-check) | Phase 11.5 |
| 12 | New Mod button broken (401 - no auth header, and never enabled on selection) | ✅ Fixed in Phase 7B |
| 13 | No way to add admins (no SuperAdmin role, roles hardcoded) | ✅ Fixed in Phase 7B (SuperAdmin, data-driven roles) |

---

## NOTES

### Decisions made
1. **Concurrency model:** whole-file last-writer-wins replaced by server-side per-id merge. Fresh saves replace; stale saves merge disjoint changes, apply explicit removals, respect tombstones. No 409 rejections - saves always land.
2. **Realtime sync:** SSE push + 30s poll fallback + `visibilitychange` re-sync. No new dependencies.
3. **Save contract:** client always sends the FULL snapshot + `baseVersion` + `deletedIds` + `removed`; server returns the merged state and the client converges to it.
4. **Public writes:** only `/api/register` (validated, deduped, role forced to Member). Everything else requires a session.
5. **Undo/redo removed:** simplified the save model; every edit is an immediate save (safe under the merge).
6. **Reserve -> Reserve:** blocked (prevents useless duplicates).
7. **Copy to Reserve:** keeps player in guild, adds to reserves (does NOT remove from guild).

### Removed from plan
- ~~4.1 Auto-Scroll on Drag Start~~ - removed by request (2026-08-18)

### Future considerations
- Discord integration (standalone module, after Phase 13)
- Multi-line notes, custom group colors, per-day announcements
- Migrate to single-array guildMembers (Phase 10) unlocks cleaner exports

*Last Updated: 2026-08-18*

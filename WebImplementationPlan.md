# WebImplementationPlan.md

## Project: Mask Sinners Guild War Management
**Current Date:** 2026-08-18
**Status:** Phase 10 + 10B Complete + code-quality pass (const/let, CSS classes, vendored FA, a11y, theme colors). Next up: Phase 11 - Code Quality & Refactoring
**Repo:** git (branch `main`) - `data/` and `config/auth.json` are git-ignored

---

## STACK & RUN

```
Node.js + Express (server.js) | vanilla JS front-end (no framework) | JSON file storage
npm start      ->  node server.js   (default port 3000)
npm run dev    ->  nodemon server.js
Dependencies: express, cors, bcrypt (now used - password hashing, Phase 9.1)
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
GET  /api/staff                        - Public staff list (names + roles only, no credentials)
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

## PHASES 6-7B (completed, documented here)

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
  - Implemented in `js/context-menu.js` (selection + actions) + `js/shortcut.js` (keys); legend auto-lists the new keys
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

## PENDING PHASES (roadmap, re-prioritized 2026-08-18)

**Priority rule:** whole-function items first (data integrity, sync correctness, working backups, auth security), then features, then structural refactors. Supabase migration + cron keep-alive are recorded as To-Dos but are **not planned work**.

### Phase 8: Data Integrity & Sync Hardening ✅ COMPLETE
- [x] **8.1 Atomic `writeDatabase`** - `atomicWriteFileSync()` (temp file + rename) used for `database.json`, `history.json`, `auth.json` and all init/default writes; verified no leftover `.tmp` files
- [x] **8.2 Persist tombstones** - `deletedPlayers` ledger stored in `database.json` (hydrated into `DELETED_PLAYERS` on boot, re-persisted with every save, pruned with the same TTL/cap); verified end-to-end: delete -> restart server -> stale snapshot cannot resurrect the player. Ledger is stripped from `GET /api/data` (clients don't need it) but included in backups
- [x] **8.3 Sync dirty-check** - `beginUserEdit()/endUserEdit()` session counter (edit forms via `toggleEditMode`, drag in flight, announcement editor); `performSync` defers (`_syncDeferred`) while a session is open and re-runs on close. Verified live: injected a simulated newer remote save while editing - the input survived untouched, and cancel re-synced
- [x] **8.4 Fix backup download** (known bug #6) - `downloadBackup()` now fetches `/api/backup` with the auth header and saves the blob (was `window.open`, always 401); wired a **DOWNLOAD BACKUP (JSON)** button into Admin Tools (mod+, shown via `data-role-show`). Verified: 401 unauth / 200 authed, Bearer header attached

### Phase 9: Security Hardening ✅ COMPLETE (auth gates the whole site)
- [x] **9.1 Hash passwords** - bcrypt (cost 10) on every password write: boot migration hashes legacy plaintext (verified live - all 4 accounts migrated, original passwords still log in), `moderators/add` (plaintext revealed once in the response for hand-off, hash stored), `reset-password`, `change-password` (bcrypt-verified current pw). `verifyPassword()` falls back to legacy plaintext compare for hand-edited files until next restart. Hashes verified `$2b$10$` on disk
- [x] **9.2 Rate limiting** - dependency-free in-memory fixed-window limiter (15 min) keyed by IP: login 20 attempts / register 15, then 429 with `retryAfter`; expired entries swept every 10 min. Verified: exactly 20 logins allowed then 429; 15 registrations then 429

### Phase 10: Export Options ✅ COMPLETE (feature)
- [x] **10.1 Export** (`js/export.js` + Export Roster section in the Help panel, role matrix):
  - **Image (PNG)** + **PDF / Print** - available to everyone including public viewers (Image is a locally canvas-rendered roster image - no screenshot library, no CDN, works offline; PDF uses the existing print stylesheet + Save as PDF)
  - **CSV player list** + **JSON backup** - moderators+ only (buttons hidden via `data-role-show="mod"` + client guard; JSON reuses the Phase 8.4 auth-header download)
  - CSV: one row per player per day (Day, Name, Class, Role, Location) with placement mapped from groups/reserves, Excel BOM, escaped cells; verified live (56 rows, correct placement)
  - Image: 1400px-wide canvas, dark themed, per-day groups/reserves/guild list; verified (1400x1172 PNG download)
  - Help & Shortcuts panel also updated with: roles legend (crown/shield/user-shield), Live-sync explanation, Export availability; distinct role icons in the user widget (SuperAdmin crown, Admin shield, Moderator swords)
  - **Refinements (user feedback):** roster image is now two columns (Saturday | Sunday) with ONE guild-member table (both days share the same list); PDF prints a dedicated printable roster (page 1 Saturday, page 2 Sunday with reserves per day, following pages the Guild Members table; the app UI incl. Register panel is hidden in print); JSON backup restricted to admins+ (both buttons); the Admin icon uses `fa-shield-alt` (the `fa-shield-halved` class does not render in FA 6.0.0-beta3)
  - **Shareable table polish (user feedback):** both PNG and PDF now use proper table formatting - Group | Members tables per day (Reserves row highlighted), bordered gridlines, alternating row shading, and an outer frame on the image. The Help-panel CSV-player-list and JSON buttons were removed (redundant): guild CSV export/import lives near the Guild panel and JSON backup lives in Admin Tools
  - **Compact layout (user feedback):** the guild-member section is now a compact 6-column "Name (Class)" grid instead of a tall one-row-per-player table (~170px vs ~800px of the image; image went from 1624px to 692px tall). The PDF now mirrors the image export exactly in landscape (@page landscape): SATURDAY | SUNDAY side by side, then the compact guild grid (the previous per-page day split is retired per user request)
  - **Spacing polish (user feedback):** uniform rhythm across both exports - one block gap (34px) between sections and one heading-to-content gap (26px) throughout, table header text baseline aligned with body rows, print table cells and guild-grid items share identical padding (5px 9px). The "Max 30 players per list (excl. reserves)" note moved from the Register panel to the Groups panel (it describes the group list limit); the export availability note under the Export buttons was removed
  - **Theme-independent exports (2026-08-18, user feedback):** both the roster image and the PDF/print now use a FIXED light, high-contrast palette instead of following the app theme. Previously the image's zebra rows were hardcoded dark (#111c2f) so light-mode exports had invisible dark-on-dark text, and the print page could keep a dark background with light text. The image now always renders white background, dark text (#0f172a/#334155), light-gray headers/zebra, and amber-700 accents readable on white; the print stylesheet forces a white page (body/html + #printRoster) with print-color-adjust: exact. Verified in-browser in BOTH themes: pixel scan shows dark text on light background, computed print styles are white/#111
  - **Divider + password accessibility (user feedback):** a horizontal divider line above the Guild Members title was added to both exports and later REMOVED again (2026-08-18, user request - see Phase 10 notes below); the password work stands. Staff can change their own password anytime via a new key icon in the user widget (was: auto-prompt for mods only right after login); the change-password submit guard now accepts admins/superadmins, and the server endpoint also covers the owner (auth.admin) - verified owner + mod round-trips on a scratch server

### Phase 10B: Guild CSV Import/Export + Public Staff ✅ COMPLETE
- [x] **Guild member CSV (admin+)** - buttons near the Guild Members panel: **Export CSV** (Name,Class,Role master list, round-trips through Excel) and **Import CSV** (modal: upload a file OR paste rows `Name,Class,Role`; day selection; live preview counting new/duplicate/bad rows; dedupe by name+class incl. within the file; 30-per-list cap; validation of class/role; history entry; saves through the normal pipeline). Verified end-to-end in-browser (preview 2 new / 1 dup / 1 bad, apply added to both days, save+history called)
- [x] **Public staff list** - new `GET /api/staff` (names + roles only, no credentials) lets public viewers see who the admins/moderators are in the Admin panel (was empty for public); staff list also loads for everyone on init
- [x] **Admin icon fix** - `fa-shield-halved` -> `fa-shield-alt` in the staff list, user widget, and roles legend (FA 6.0.0-beta3 does not ship the renamed icon)

### Phase 11: Code Quality & Refactoring (structural - in progress)
From the 2026-08-18 review; all items are behavior-preserving and verified by the existing manual regression suite.
- [x] **11.1 Split `server.js`** (was ~1500 lines -> now a ~90-line boot file) into:
  - `server/util.js` - atomicWriteFileSync
  - `server/auth.js` - sessions, auth middleware (requireAuth/Admin/SuperAdmin), bcrypt hashing + migration, auth config read/write/init
  - `server/data.js` - database read/write/init, tombstone hydration/persistence, guild-members migration
  - `server/merge.js` - tombstone ledger (DELETED_PLAYERS) + merge engine (mergeDatabase/mergeGroupsDay/mergePlayersById/removeDeletedFromDb/applyRemovals)
  - `server/history.js` - history read/write/init + appendHistory
  - `server/rate-limit.js` - fixed-window limiter (login/register)
  - `server/sse.js` - SSE client set + broadcastUpdate
  - `server/route/auth.js` - login/logout/session/moderators/*/auth-settings/staff (registered via `register(app, ctx)`)
  - `server/route/data.js` - data GET/POST, /api/events, register, guild name, groups/*, migrate endpoints, backup, health
  - `server/route/history.js` - history GET/POST/init/clear
  - Dependencies are one-way (data -> merge, auth/history/data -> util); routes receive a shared `ctx` object. `__dirname` paths adjusted with `..` so data/config resolve to the repo root. Verified: 17/17 API parity checks on a scratch copy (login, staff, save, register, history, groups, backup, 401 guard, owner password change) + live 3000 restart + UI clean
- [x] **11.2 Split `main.js`** (1670 -> ~1030 lines): extracted verbatim into four new modules loaded before main.js - `js/sync.js` (sync engine: poll/SSE/focus re-sync + Phase 8.3 dirty-check, SYNC_INTERVAL), `js/admin-panel.js` (setupAdminTools/setupAdminControls/setupChangePassword), `js/panel.js` (setupScrollShadow/save+restoreCollapseState/setupCollapsiblePanels/setupModalFocusTraps), `js/help.js` (renderHelpPanel). main.js keeps the shared data layer (saveState/loadState/applyServerData/showConfirmation/updateLastUpdate - called from 8 other files), the editing setups (guild name, groups, registration, reserves, guild actions, day tabs) and init. Cross-file callers confirmed before the move (beginUserEdit/endUserEdit from announcement/dragdrop/event-handler; renderHelpPanel from auth-module). Verified in browser: login as admin, help panel switches to mod view, all admin buttons + change-password modal work, collapsibles persist, sync dirty-check (begin/endUserEdit), zero console errors
- [x] **11.3 Shared `js/util.js`** - `esc`, `getAuthHeader`, `downloadBlob`, `downloadDataUrl`, `csvEscape`, `parseCSVRows`; local copies deleted from helper.js / api.js / export.js and call sites updated (backup download reuses shared downloadBlob). Verified: CSV export + parser round-trip in browser, no console errors
- [ ] **11.4 Diffed/targeted rendering** - replace full `render()` rebuilds on save with panel-level DOM updates (fixes focus loss + DOM churn; keeps the Phase 8.3 dirty-check as a safety net). Review item #10 (deferred updates) assessed: no usability impact - polling 30s + SSE push + focus-resync already deliver updates within seconds; diffed rendering only affects local redraw speed, not update arrival
- [ ] **11.5 `App.state` consolidation** - single state object for `window.groups/reserves/guildMembers/moderators/lastUpdateTime` (makes sync/render/test simpler)
- [ ] **11.6 Finish the CSS-class migration** for the remaining ~66 inline `style=` in index.html + JS-generated markup (utilities: btn-auto/btn-xl/btn-active/flex-row-sm/select-field/modal-sm already added)
- [ ] **11.7 Sync optimization (review #9)** - `performSync` currently JSON-stringifies the whole state on every poll just to detect change; compare the server's data timestamp first and skip the stringify/merge unless an actual update arrived. Tied to the current JSON-file framework: a future Supabase migration replaces this with versioned rows + row-level subscriptions (see Recorded To-Dos), so this only pays off if we stay on JSON. SSE push stays ping-only (re-fetch on ping) - see note below
- [x] **11.8 Automated tests (review #11)** - `npm test` (Node built-in runner, zero new deps) - 27 tests across `test/`: merge engine (stale merge preserves other editors' players, one-player-per-group both directions, tombstone blocking, removeDeletedFromDb, applyRemovals, TTL/cap pruning), tombstone ledger disk round-trip simulating a restart, atomic writes (no .tmp leftover, overwrite, large payload), rate limiter (exactly N then block, independent keys, window expiry), CSV parser/escape + esc XSS. `js/util.js` got a dual-mode `module.exports` guard so its pure helpers are importable under node --test (no-op in the browser)
  - **Bug found + fixed by the tests (merge engine):** `mergeGroupsDay` claimed ids while iterating groups in key order, so when an incoming client moved a player into a group (leaving the source group empty) while the stored DB still had them in the source group, the stale copy was pulled back in before the move was claimed - the player ended up in TWO groups. The one-group-per-day invariant was iteration-order-dependent. Fixed with a two-pass approach: collect every incoming-placed id first, then build groups. Regression test covers it; live server restarted on the fix and verified with a stale-save smoke test (marker merged, then removed - data pristine)
- **Resolved (no work item):** review #12 (persistent SSE across server restarts) - declined by owner; the current in-memory SSE is fine since a restart just reconnects. Review #13 (FontAwesome CDN) - already fixed by vendoring to `vendor/font-awesome/` (see earlier commit)
- **Naming standard (applied 2026-08-18):** no trailing `s` on custom file names even when plural is grammatically correct - `routes.js` -> `route.js`, `utils.js` -> `util.js`, etc. All custom js/css renamed: `helpers.js` -> `helper.js`, `event-handlers.js` -> `event-handler.js`, `render-helpers.js` -> `render-helper.js`, `bulk-actions.*` -> `bulk-action.*`, `shortcuts.*` -> `shortcut.*`, `day-tabs.css` -> `day-tab.css`, `guild-cards.css` -> `guild-card.css`, `variables.css` -> `variable.css`

### Phase 12: Mobile & Accessibility
- [ ] **12.1 Mobile optimization** (was 9.1) - 44px touch targets, swipe day navigation, responsive grids, mobile menu
- [ ] **12.2 Accessibility** (was 9.2) - ARIA labels (partial done), keyboard navigation, color contrast, modal focus trap (done), icon-button labels

### Phase 13: Data Model Simplification (known bug #5 - DEFERRED, high blast radius)
- [ ] `guildMembers` from `{ sat: [], sun: [] }` to a single array
  - Touches every client file + server readers; only worth the risk if the day-split actually causes bugs in practice. Phase 10 exports may make the need concrete.

### RECORDED ONLY - NOT PLANNED (To-Do list)
Kept on record for context; **not work to be done**.
- **Supabase migration** (was To-Do #2): move JSON storage to Postgres/Supabase. Would rewrite the whole data layer; the current JSON store + merge engine works for this LAN guild tool.
- **Cron keep-alive** (was To-Do #3): weekly ping to keep a Supabase instance alive. Only relevant if Supabase is ever adopted.

---

## PROJECT STRUCTURE (current)

```
guild-war-management/            (git repo, branch main)
├── index.html                   done
├── server.js                    done (Phase 11.1 boot file: middleware + route wiring + init + listen)
├── server/                      done (Phase 11.1 split - one-way deps, ctx wiring)
│   ├── util.js                  done - atomicWriteFileSync
│   ├── auth.js                  done - sessions, middleware, bcrypt, auth config
│   ├── data.js                  done - database read/write/init, tombstone persistence, migration
│   ├── merge.js                 done - tombstone ledger + merge engine
│   ├── history.js               done - history read/write/init + append
│   ├── rate-limit.js            done - login/register limiter
│   ├── sse.js                   done - SSE client set + broadcast
│   └── route/
│       ├── auth.js              done - login/logout/session/moderators/settings/staff
│       ├── data.js              done - data/events/register/groups/migrate/backup/health
│       └── history.js           done - history GET/POST/init/clear
├── package.json                 done
├── WebImplementationPlan.md     done (THIS FILE)
├── .gitignore                   done (node_modules, data/, config/auth.json, backups/, .kilo, .freebuff)
├── config/
│   └── auth.json                done (git-ignored, bcrypt-hashed passwords)
├── data/
│   ├── database.json            done (git-ignored)
│   └── history.json             done (git-ignored)
├── css/                         done - 19 files (variable, main, header, day-tab, toast,
│                                  bulk-action, guild-card, shortcut, diagram,
│                                  admin-view, public-view, reserve, guild-member,
│                                  side-panel, admin-panel, announcement, modal, responsive)
├── js/                          (naming standard: no trailing 's' on custom files)
    ├── main.js                  done - sync engine (SSE + poll + merge payload)
    ├── api.js                   done - registerPlayer + auth header
    ├── auth-module.js           done - sessions, change-password
    ├── helper.js                done - esc() + pending removal/delete tracking
    ├── render.js                done - main render
    ├── render-helper.js         done - guild cards from master list
    ├── event-handler.js         done - inline edit, checkbox handlers
    ├── dragdrop.js              done - drag & drop
    ├── bulk-action.js           done - copy/delete/clear selected
    ├── history.js               done - history tracking
    ├── announcement.js          done - announcements
    ├── shortcut.js              done - ? / Ctrl+S / Ctrl+T / Escape + C/M/E/Delete
    ├── context-menu.js          done - Phase 7: right-click menu + click-to-select
    ├── theme.js                 done - theme management
    ├── toast.js                 done - toast system
    ├── data.js                  done - sample/fallback data
    └── util.js                  done (11.3) - esc/getAuthHeader/download/CSV helpers (shared)
    (export.js - done Phase 10; cron.js - not planned, see Recorded To-Dos)
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
| Phase 8: Data Integrity & Sync Hardening | ✅ complete | 100% |
| Phase 9: Security Hardening | ✅ complete | 100% |
| Phase 10: Export Options | ✅ complete | 100% |
| Phase 10B: Guild CSV Import/Export + Public Staff | ✅ complete | 100% |
| Phase 11: Code Quality & Refactoring | pending | 0% |
| Phase 12: Mobile & Accessibility | pending | 0% |
| Phase 13: Data Model Simplification | deferred | 0% |
| Recorded (not planned): Supabase + Cron | recorded only | - |

**Overall Progress:** ~99.5%

---

## KNOWN BUGS -> PHASE MAP

| # | Bug | Where it's fixed |
|---|-----|------------------|
| 1 | Add Group button not working | ✅ Fixed in Phase 6.1 (was never initialized + missing auth header) |
| 2 | No right-click context menu | ✅ Fixed in Phase 7.1 (context-menu.js) |
| 3 | No extended keyboard shortcuts (C/M/E/Delete) | ✅ Fixed in Phase 7.2 (click-to-select + keys) |
| 4 | Group deletion not implemented | ✅ Fixed in Phase 6.2 (remove button + confirmation + non-empty guard) |
| 5 | guildMembers day-specific (should be single array) | Phase 13 (deferred - high blast radius) |
| 6 | Backup download 401s (window.open without auth header) | ✅ Fixed in Phase 8.4 (fetch + auth header + button in Admin Tools) |
| 7 | `config/auth.json` plaintext passwords (bcrypt unused) | ✅ Fixed in Phase 9.1 (bcrypt hashes + boot migration) |
| 8 | No rate limiting on login/register | ✅ Fixed in Phase 9.2 (20 login / 15 register per 15 min, 429 + retryAfter) |
| 9 | Non-atomic writeDatabase (crash can corrupt JSON) | ✅ Fixed in Phase 8.1 (temp + rename) |
| 10 | Tombstones in-memory only (lost on restart) | ✅ Fixed in Phase 8.2 (persisted ledger) |
| 11 | Poll can wipe an in-progress edit (no dirty-check) | ✅ Fixed in Phase 8.3 (deferred sync) |
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
- Discord integration (standalone module, after the current roadmap)
- Multi-line notes, custom group colors, per-day announcements
- Migrate to single-array guildMembers (Phase 13) unlocks cleaner exports
- ~~**CSV import of guild members (Admin+)**~~ -> IMPLEMENTED as Phase 10B (export + file upload + paste import near the Guild panel)
- **JSON restore (Admin+)** - the backup currently has NO upload path: restoring means stopping the server, replacing `data/database.json`, restarting (manual, documented). A Restore-from-backup upload (validate JSON, overwrite via the atomic writer, full history entry) is the natural companion to the CSV import feature and would make backups genuinely usable end-to-end.

*Last Updated: 2026-08-18*

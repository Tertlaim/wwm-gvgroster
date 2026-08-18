```markdown
# WebImplementationPlan.md

## Project: Mask Sinners Guild War Management
**Current Date:** 2026-08-15
**Status:** Phase 3 Complete (with Master List Fix)
**Next Phase:** Phase 4 - Polish & Export

---

## 📋 COMPLETED PHASES

### ✅ Phase 1: Core System
- [x] Unique ID system (timestamp-based IDs for all players)
- [x] Toast notifications (replaced blocking modals)
- [x] CSS variables + themes (dark/light toggle)
- [x] Sticky header + tabs
- [x] Theme toggle button (top right)

### ✅ Phase 2: Bulk Actions & Cards
- [x] Bulk selection (checkboxes across groups)
- [x] ~~Bulk move to Reserve/Guild~~ → **UPDATED: Copy to Reserve** (keep in guild, add to reserves)
- [x] Bulk delete (Admin only, removes from ALL sources)
- [x] ~~Bulk role/class change~~ → **REMOVED** (not needed for guild panel)
- [x] Guild member cards (grid layout)
- [x] Player notes (140 char limit, hover tooltip)
- [x] Card editing (name, class, role)
- [x] Drag & drop for guild cards

### ✅ Phase 3: History & Shortcuts
- [x] History panel (recent changes)
- [x] History logging (moves, edits, adds, deletes)
- [x] Clear history button
- [x] Keyboard shortcuts legend (Ctrl+S, Ctrl+T, Escape)
- [x] Date format: "15 Aug 2026, 02:58 AM"
- [x] Reserve → Reserve duplicate blocking
- [x] Master List Logic (guildMembers as source of truth)

### ✅ Phase 3.5: Master List Fix (Completed)
- [x] `guildMembers` is now the master list of ALL players
- [x] Registration adds to `guildMembers` + `reserves`
- [x] `renderGuildCards()` uses `getGuildMembers()` (master list)
- [x] Server-side migration to populate guildMembers from existing data
- [x] Bulk Copy to Reserve (keep in guild, add to reserves)
- [x] Bulk Delete removes from ALL sources (Admin only)
- [x] Removed unnecessary buttons (Move to Guild, Role/Class dropdowns)

---

## 🔧 CURRENT CODE STATUS

### CSS Files:
```
css/variables.css          ✅ Theme variables
css/toast.css              ✅ Toast notifications
css/header.css             ✅ Sticky header
css/day-tabs.css           ✅ Sticky tabs
css/bulk-actions.css       ✅ Bulk selection
css/guild-cards.css        ✅ Card layout
css/shortcuts.css          ✅ Keyboard shortcuts
css/main.css               ✅ Base styles
css/diagram.css            ✅ Group grid
css/admin-view.css         ✅ Admin styles
css/public-view.css        ✅ Public styles
css/reserve.css            ✅ Reserve styles
css/guild-member.css       ✅ Guild member styles
css/side-panel.css         ✅ Side panel
css/admin-panel.css        ✅ Admin panel
css/announcement.css       ✅ Announcement
css/modal.css              ✅ Modals
css/responsive.css         ✅ Responsive
```

### JS Files:
```
js/helpers.js             ✅ Helper functions (getGuildMembers returns master list)
js/api.js                 ✅ API calls
js/auth-module.js         ✅ Authentication
js/toast.js               ✅ Toast system
js/theme.js               ✅ Theme management
js/event-handlers.js      ✅ Event handlers
js/render-helpers.js      ✅ Rendering helpers (guild cards from master list)
js/render.js              ✅ Main render
js/dragdrop.js            ✅ Drag & drop
js/bulk-actions.js        ✅ Bulk operations (Copy to Reserve, Delete from ALL)
js/history.js             ✅ History tracking
js/announcement.js        ✅ Announcements
js/main.js                ✅ Main application (registration adds to master list)
js/data.js                ✅ Sample data
```

### Data Files:
```
data/database.json        ✅ Main data with master list populated
data/history.json         ✅ History log
config/auth.json          ✅ Admin/moderator credentials
```

---

## 🔄 CURRENT BEHAVIOR

### Master List Logic (IMPORTANT)
| Concept | Description |
|---------|-------------|
| **guildMembers** | Master list of ALL players (regardless of where they are) |
| **groups** | Players assigned to groups (subset of master list) |
| **reserves** | Players in reserves (subset of master list) |

### Rules
| Action | guildMembers (Master) | groups | reserves |
|--------|----------------------|--------|----------|
| **Register** | ✅ ADD | ❌ | ✅ ADD |
| **Copy to Reserve** | ✅ KEEP | ✅ KEEP | ✅ ADD |
| **Move to Group** | ✅ KEEP | ✅ ADD | ❌ REMOVE (if moving from reserve) |
| **Move to Reserve** | ✅ KEEP | ❌ REMOVE (if moving from group) | ✅ ADD |
| **Delete** | ❌ REMOVE | ❌ REMOVE | ❌ REMOVE |

### Permissions
| Role | Copy to Reserve | Delete |
|------|----------------|--------|
| **Admin** | ✅ | ✅ |
| **Moderator** | ✅ | ❌ |
| **Public** | ❌ | ❌ |

### Drag & Drop
| Action | Behavior |
|--------|----------|
| **Guild → Group** | ✅ MOVE (remove from guild, add to group) |
| **Guild → Reserve** | ✅ MOVE (remove from guild, add to reserve) |
| **Reserve → Guild** | ✅ MOVE (remove from reserve, add to guild) |
| **Group → Guild** | ✅ MOVE (remove from group, add to guild) |
| **Group → Reserve** | ✅ MOVE (remove from group, add to reserve) |
| **Reserve → Group** | ✅ MOVE (remove from reserve, add to group) |
| **Group → Group** | ✅ MOVE (remove from source, add to target) |
| **Reserve → Reserve** | ✅ BLOCKED (prevents useless duplicates) |

### Bulk Actions
| Button | Behavior |
|--------|----------|
| **Copy to Reserve** | ✅ COPY from guild to reserves (keep in guild). Moderators+ |
| **Delete** | ❌ Remove from ALL sources (guild, groups, reserves). Admin only |

### Guild Actions
| Button | Behavior |
|--------|----------|
| **Copy to Reserve** | ✅ COPY selected from guild to reserves (keep in guild). Moderators+ |
| **Delete Selected** | ❌ Remove from ALL sources (guild, groups, reserves). Admin only |

### Editing
- ✅ Click edit icon → inline editing
- ✅ Enter to save, Escape to cancel
- ✅ Cursor positioned at end of text
- ✅ Unique IDs prevent editing wrong player

### History
- ✅ Logs all actions (moves, edits, adds, deletes, bulk actions)
- ✅ Shows recent changes in side panel
- ✅ Clear history (admin only)
- ✅ FIFO cleanup (keeps last 100 entries)

### Keyboard Shortcuts
- ✅ `?` or `Ctrl+/` → Show shortcuts legend
- ✅ `Ctrl+S` → Save state
- ✅ `Ctrl+T` → Toggle theme
- ✅ `Escape` → Cancel edit / Close modals / Clear selection

---

## 🔜 NEXT PHASES

### Phase 4: Polish & Export (PENDING)

#### 4.1 Auto-Scroll on Drag Start
**Goal:** When dragging guild cards (bottom panel), auto-scroll to show reserve area

**Implementation:**
```javascript
// In dragdrop.js - handleDragStart()
if (isFromGuild) {
    scrollToReserves();
}

function scrollToReserves() {
    var reserveArea = document.getElementById('reserveArea');
    if (reserveArea) {
        reserveArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}
```

**Files:**
- `js/dragdrop.js`

---

#### 4.2 Right-Click Context Menu
**Goal:** Right-click on any player → context menu with actions

**Options:**
- Copy to Reserve
- Move to Group → (submenu with all groups)
- Edit Player (if admin/mod)
- Delete (if admin)

**Files to create:**
- `js/context-menu.js`
- `css/context-menu.css`

**Files to modify:**
- `index.html` (add context menu container)
- `js/main.js` (initialize context menu)

**UI Design:**
```
┌─────────────────────────────┐
│ 📋 Copy to Reserve          │
│ 📦 Move to Group ▶          │ ← Hover to expand
│   ├── Offense 1 (6)        │
│   ├── Offense 2 (5)        │
│   ├── Defense (3)          │
│   └── Jungle (4)           │
│ ✏️ Edit Player              │
│ 🗑️ Delete                   │
└─────────────────────────────┘
```

---

#### 4.3 Keyboard Shortcuts (Extended)
**Goal:** Click to select a player → press key to move

**Shortcuts:**
| Key | Action |
|-----|--------|
| `C` | Copy to Reserve |
| `M` | Move to Group (opens menu) |
| `E` | Edit player (if mod/admin) |
| `Delete` | Delete player (if admin) |

**Behavior:**
- Click a player to select (highlight)
- Press key to perform action
- Click outside to deselect

**Files:**
- `js/dragdrop.js` (add selection and keyboard handling)

---

#### 4.4 Export Options
**Goal:** Multiple export formats

**Options:**
- JSON export (full backup)
- CSV export (player list)
- Image export (screenshot)
- PDF export (printable roster)

**Files:**
- `js/export.js` (NEW)
- Add export buttons to `index.html`

---

#### 4.5 Mobile Optimization
**Goal:** Better mobile experience

**Changes:**
- Larger touch targets (44px)
- Swipe navigation for days
- Responsive grids
- Mobile menu

**Files:**
- `css/responsive.css`
- `index.html`

---

#### 4.6 Accessibility
**Goal:** ARIA labels, screen reader support

**Changes:**
- ARIA labels on interactive elements
- Keyboard navigation
- Color contrast

**Files:**
- `index.html`
- `js/main.js`

---

## 🗃️ TO-DO LIST (NEW)

### 1. Admin Tools: Add Delete Button for Groups
**Goal:** Add "Remove Group" button in Admin Tools. Currently there is "Add Group" but no remove option.

**Implementation:**
- Add delete/remove button next to each group (or a dropdown with delete option)
- When clicked, show confirmation before removing
- Only visible to Admin

**Files:**
- `index.html` (add remove button)
- `js/main.js` (add remove group function)
- `server.js` (add API endpoint if needed)

**Notes:**
- The "Add Group" button currently not working. Needs fixing.
- Saturday/Sunday selection should follow current viewed tab (automatic, no dropdown needed)

---

### 2. Migration to Supabase
**Goal:** Migrate from local JSON file storage to Supabase (PostgreSQL)

**Implementation:**
- Set up Supabase project
- Create tables for: groups, reserves, guildMembers, history, auth
- Update `server.js` to use Supabase client instead of fs
- Maintain backward compatibility during migration

**Files:**
- `server.js` (major rewrite)
- `package.json` (add `@supabase/supabase-js` dependency)
- `.env` (add Supabase credentials)

**Tables:**
```
guild_config (guildName, announcement, lastUpdateTime)
groups (id, day, group_key, title, players JSON)
reserves (id, day, player_id, player_data JSON)
guild_members (id, day, player_id, player_data JSON)
history (id, action, playerId, playerName, from, to, day, details, timestamp, user)
auth (id, username, password, role, created_at)
```

---

### 3. Cron Job for Supabase (Keep Alive)
**Goal:** Keep Supabase instance active with weekly ping

**Implementation:**
- Use `node-cron` or `cron` package
- Ping the `/api/health` endpoint weekly
- Or set up external cron service (cron-job.org, UptimeRobot)

**Files:**
- `server.js` (add health check endpoint if not exists)
- `cron.js` (NEW) - separate cron job file

**Schedule:** Weekly (e.g., every Sunday at 12:00 AM)

---

### 4. Admin Tools: Inline Guild Name Editing
**Goal:** Edit guild name inline (instead of separate input + button)

**Implementation:**
- Click guild name → becomes editable input
- Enter to save, Escape to cancel
- Visual feedback on save

**Current:** Separate input field + update button
**New:** Inline editing (click to edit, Enter to save)

**Files:**
- `index.html` (update guild name display)
- `js/main.js` (inline edit logic)

---

### 5. Recent Changes Panel: Extend to Bottom
**Goal:** Make history panel taller, showing more entries

**Current:** `max-height: 200px`
**New:** `max-height: 60vh` or extend to bottom of page

**Implementation:**
- Increase max-height
- Make it scrollable
- Show more entries (50+ instead of 20)

**Files:**
- `index.html` (update CSS class)
- `css/side-panel.css` (update max-height)

---

### 6. Edit: Single Line + Enter to Commit
**Goal:** Editing should commit on Enter key, single-line only

**Current:** Multiple lines possible, Enter sometimes not committing
**New:** 
- Single line input (no multi-line)
- Enter key commits immediately
- Escape cancels

**Files:**
- `js/event-handlers.js` (update edit logic)
- `js/render-helpers.js` (update input fields to single line)

---

### 7. Move Group Counter Below Group Panel
**Goal:** Move the group stats counter from above the group grid to below it

**Current:** Group stats displayed above the group grid
**New:** Group stats displayed below the group grid

**Implementation:**
- Move the HTML element
- Update CSS positioning

**Files:**
- `index.html` (move group stats element)
- `css/diagram.css` (update positioning)

---

## 🐛 KNOWN BUGS TO FIX

### High Priority
1. **Auto-scroll for guild card drag** - Guild panel is at bottom, need scroll to reserves (Plan 4.1)
2. **Add Group button not working** - Admin Tools add group button needs fixing (To-Do #1)

### Medium Priority
3. **Right-click context menu** - Need to implement (Plan 4.2)
4. **Keyboard shortcuts for move/copy** - Need to implement (Plan 4.3)
5. **Group deletion** - Need to add remove group button (To-Do #1)
6. **guildMembers day-specific** - Currently day-specific, simplify to single array later

### Low Priority
7. **Group labels** - B1-B6 working ✅
8. **Duplicate highlighting** - Working ✅
9. **Date format** - Fixed to "15 Aug 2026, 02:58 AM" ✅

---

## 📁 PROJECT STRUCTURE

```
guild-war-management/
├── index.html                      ✅
├── server.js                       ✅ (with migration endpoint)
├── package.json                    ✅
├── WebImplementationPlan.md        ✅ (THIS FILE)
├── .env                            ⏳ (Supabase credentials - To-Do #2)
├── config/
│   └── auth.json                   ✅
├── data/
│   ├── database.json               ✅ (with master list populated)
│   └── history.json                ✅
├── css/
│   ├── variables.css               ✅
│   ├── main.css                    ✅
│   ├── header.css                  ✅
│   ├── day-tabs.css                ✅
│   ├── toast.css                   ✅
│   ├── bulk-actions.css            ✅
│   ├── guild-cards.css             ✅
│   ├── shortcuts.css               ✅
│   ├── diagram.css                 ✅
│   ├── admin-view.css              ✅
│   ├── public-view.css             ✅
│   ├── reserve.css                 ✅
│   ├── guild-member.css            ✅
│   ├── side-panel.css              ✅
│   ├── admin-panel.css             ✅
│   ├── announcement.css            ✅
│   ├── modal.css                   ✅
│   ├── responsive.css              ✅
│   └── context-menu.css            ⏳ (Phase 4)
└── js/
    ├── data.js                     ✅
    ├── helpers.js                  ✅
    ├── api.js                      ✅
    ├── auth-module.js              ✅
    ├── toast.js                    ✅
    ├── theme.js                    ✅
    ├── event-handlers.js           ✅
    ├── render-helpers.js           ✅
    ├── render.js                   ✅
    ├── dragdrop.js                 ✅
    ├── bulk-actions.js             ✅
    ├── history.js                  ✅
    ├── announcement.js             ✅
    ├── main.js                     ✅
    ├── context-menu.js             ⏳ (Phase 4)
    ├── export.js                   ⏳ (Phase 4)
    └── cron.js                     ⏳ (To-Do #3)
```

---

## 🚀 NEXT SESSION START POINT

When starting the next session, say:

> "Continue from Phase 4 of WebImplementationPlan.md. Start with the To-Do list item 1: Fix Admin Tools - Add Group button and Add Delete button for groups."

---

## 📊 PROGRESS METRICS

| Phase | Status | Progress |
|-------|--------|----------|
| Phase 1: Core System | ✅ Complete | 100% |
| Phase 2: Bulk Actions & Cards | ✅ Complete (with fixes) | 100% |
| Phase 3: History & Shortcuts | ✅ Complete | 100% |
| Phase 3.5: Master List Fix | ✅ Complete | 100% |
| Phase 4: Polish & Export | ⏳ Pending | 0% |
| Phase 5: Discord Integration | ⏳ Future | 0% |
| To-Do List | ⏳ Pending | 0% |

**Overall Progress:** 80%

---

## 🔗 QUICK REFERENCE

### Login
- Admin: `Tertlaim` / `Sin1234`
- Moderators: Set up via admin panel

### API Endpoints
```
GET  /api/data                    - Load data
POST /api/data                    - Save data
POST /api/login                   - Authenticate
GET  /api/history                 - Get history
POST /api/history                 - Add history entry
DELETE /api/history               - Clear history (admin)
GET  /api/backup                  - Download backup
POST /api/migrate-guild-members   - Migrate master list (admin only)
GET  /api/guild-members-status    - Check migration status
```

### Keyboard Shortcuts
```
? or Ctrl+/  → Show shortcuts legend
Ctrl+S       → Save state
Ctrl+T       → Toggle theme
Escape       → Cancel/Close
```

---

## 📝 NOTES

### Decisions Made
1. **Floating Panel:** Removed (didn't work well, replaced with future right-click + keyboard)
2. **Reserve→Reserve:** Blocked (prevents useless duplicates)
3. **Date Format:** `15 Aug 2026, 02:58 AM`
4. **Group Labels:** B1, B2, B3, B4, B5, B6 (dynamic)
5. **History Cleanup:** FIFO - keeps last 100 entries
6. **Master List:** `guildMembers` is the source of truth for ALL players
7. **Copy to Reserve:** Keeps player in guild, adds to reserves (does NOT remove from guild)
8. **Delete:** Removes from ALL sources (guild, groups, reserves) - Admin only
9. **guildMembers Structure:** Currently day-specific (sat/sun). Fix later to single array.
10. **Group Stats Position:** Move to below group grid (To-Do #7)

### Future Considerations
1. **Discord Integration:** Standalone module (Phase 5)
2. **Export Options:** JSON, CSV, Image, PDF (Phase 4)
3. **Mobile Optimization:** Touch targets, swipe navigation (Phase 4)
4. **Simplify guildMembers:** Change from `{ sat: [], sun: [] }` to single array `[]`
5. **Supabase Migration:** Move from JSON to PostgreSQL (To-Do #2)
6. **Cron Job:** Weekly keep-alive for Supabase (To-Do #3)

---

*Last Updated: 2026-08-15*
```
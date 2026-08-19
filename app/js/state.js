// ============================================================
// STATE - Consolidated application state (Phase 11.5)
// Single source of truth for the synced roster data, replacing the
// scattered App.state.groups/reserves/guildMembers/moderators/
// lastUpdateTime/guildName/announcementText globals. Modules read
// and write App.state.* directly; sync/render/test all share it.
// Load this file before any module that touches state.
// ============================================================

const App = {
    state: {
        groups: {},           // { sat: { groupKey: { title, players } }, sun: ... }
        reserves: {},         // { sat: [players], sun: [players] }
        guildMembers: [],     // Phase 13: single flat array of all registered players
        moderators: {},       // username -> role (staff list for everyone)
        lastUpdateTime: null, // ISO timestamp of the latest server save
        guildName: '',        // e.g. 'Mask Sinners'
        announcement: { text: '', author: '', timestamp: '' }  // current announcement with metadata
    }
};

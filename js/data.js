// ============================================================
//  SAMPLE DATA - Based on provided structure with roles
// ============================================================
const SAMPLE_DATA = {
    groups: {
        sat: {
            offence1: { 
                title: 'Offense 1', 
                players: [
                    { name: 'Kaste', class: 'Tank', role: 'Commander' },
                    { name: 'Lelandi', class: 'DPS', role: 'Vice Commander' },
                    { name: 'Zuzu', class: 'Heal', role: 'Healer' },
                    { name: 'Saineria', class: 'DPS', role: 'Member' },
                    { name: 'Rice Millet', class: 'DPS', role: 'Member' },
                    { name: 'Kajia', class: 'DPS', role: 'Member' }
                ] 
            },
            offence2: { 
                title: 'Offense 2', 
                players: [
                    { name: 'Therana', class: 'DPS', role: 'Commander' },
                    { name: 'Malacat', class: 'Tank', role: 'Vice Commander' },
                    { name: 'Crackles', class: 'Heal', role: 'Healer' },
                    { name: 'Pieroth', class: 'DPS', role: 'Member' },
                    { name: 'Mirne', class: 'DPS', role: 'Member' },
                    { name: 'Kyushou', class: 'DPS', role: 'Member' }
                ] 
            },
            defence1: { 
                title: 'Defense', 
                players: [
                    { name: 'Hua', class: 'Tank', role: 'Commander' },
                    { name: 'Antony', class: 'Heal', role: 'Vice Commander' },
                    { name: 'LiCa', class: 'DPS', role: 'Member' }
                ] 
            },
            jungle: { 
                title: 'Jungle', 
                players: [
                    { name: 'Bayu', class: 'DPS', role: 'Commander' },
                    { name: 'Tert', class: 'DPS', role: 'Vice Commander' },
                    { name: 'Shen', class: 'DPS', role: 'Member' },
                    { name: 'Ycraya', class: 'DPS', role: 'Member' }
                ] 
            }
        },
        sun: {
            offence1: { 
                title: 'Offense 1', 
                players: [
                    { name: 'Kaste', class: 'Tank', role: 'Commander' },
                    { name: 'Lelandi', class: 'DPS', role: 'Vice Commander' },
                    { name: 'Zuzu', class: 'Heal', role: 'Healer' },
                    { name: 'Saineria', class: 'DPS', role: 'Member' },
                    { name: 'Rice Millet', class: 'DPS', role: 'Member' },
                    { name: 'Shen (Sun)', class: 'DPS', role: 'Member' }
                ] 
            },
            offence2: { 
                title: 'Offense 2', 
                players: [
                    { name: 'Therana', class: 'DPS', role: 'Commander' },
                    { name: 'Malacat', class: 'Tank', role: 'Vice Commander' },
                    { name: 'Crackles', class: 'Heal', role: 'Healer' },
                    { name: 'Pieroth', class: 'DPS', role: 'Member' },
                    { name: 'Nemo', class: 'DPS', role: 'Member' },
                    { name: 'Yume', class: 'DPS', role: 'Member' }
                ] 
            },
            defence1: { 
                title: 'Defense', 
                players: [
                    { name: 'Hua', class: 'Tank', role: 'Commander' },
                    { name: 'Antony', class: 'Heal', role: 'Vice Commander' },
                    { name: 'LiCa', class: 'DPS', role: 'Member' },
                    { name: 'Murder', class: 'DPS', role: 'Member' }
                ] 
            },
            jungle: { 
                title: 'Jungle', 
                players: [
                    { name: 'Bayu', class: 'DPS', role: 'Commander' },
                    { name: 'Tert', class: 'DPS', role: 'Vice Commander' },
                    { name: 'Shen', class: 'DPS', role: 'Member' },
                    { name: 'Ycraya', class: 'DPS', role: 'Member' },
                    { name: 'Biko', class: 'DPS', role: 'Member' }
                ] 
            }
        }
    },
    reserves: {
        sat: [
            { name: 'NOreasON', class: 'DPS', role: 'Member' },
            { name: 'Niszqa', class: 'DPS', role: 'Member' },
            { name: 'Whisperr', class: 'Heal', role: 'Member' },
            { name: 'Katsu', class: 'DPS', role: 'Member' },
            { name: 'Mao', class: 'DPS', role: 'Member' },
            { name: 'Vileria', class: 'DPS', role: 'Member' },
            { name: 'Fjordwitch', class: 'DPS', role: 'Member' }
        ],
        sun: [
            { name: 'NOreasON', class: 'DPS', role: 'Member' },
            { name: 'Niszqa', class: 'DPS', role: 'Member' },
            { name: 'Whisperr', class: 'Heal', role: 'Member' },
            { name: 'Katsu', class: 'DPS', role: 'Member' },
            { name: 'Mao', class: 'DPS', role: 'Member' },
            { name: 'Vileria', class: 'DPS', role: 'Member' },
            { name: 'Fjordwitch', class: 'DPS', role: 'Member' }
        ]
    },
    guildMembers: [],
    moderators: { 'Eira': 'Mod123', 'Thorne': 'Mod123', 'Vex': 'Mod123' }
};

// Calculate guild members (players not in groups or reserves)
function calculateGuildMembers() {
    const days = ['sat', 'sun'];
    const groupKeys = ['offence1', 'offence2', 'defence1', 'jungle'];
    
    // Collect all players from groups and reserves
    const usedPlayers = new Set();
    const allPlayers = new Map();
    
    days.forEach(day => {
        groupKeys.forEach(key => {
            if (SAMPLE_DATA.groups[day] && SAMPLE_DATA.groups[day][key]) {
                SAMPLE_DATA.groups[day][key].players.forEach(p => {
                    usedPlayers.add(p.name);
                    if (!allPlayers.has(p.name)) {
                        allPlayers.set(p.name, { class: p.class, role: p.role || 'Member' });
                    }
                });
            }
        });
        if (SAMPLE_DATA.reserves[day]) {
            SAMPLE_DATA.reserves[day].forEach(p => {
                usedPlayers.add(p.name);
                if (!allPlayers.has(p.name)) {
                    allPlayers.set(p.name, { class: p.class, role: p.role || 'Member' });
                }
            });
        }
    });
    
    // Guild members = all players not used in groups or reserves
    const guildMembers = [];
    allPlayers.forEach((data, name) => {
        if (!usedPlayers.has(name)) {
            guildMembers.push({ name, class: data.class, role: data.role });
        }
    });
    
    SAMPLE_DATA.guildMembers = guildMembers;
}

// Calculate guild members on load
calculateGuildMembers();
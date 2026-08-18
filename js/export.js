// ============================================================
// EXPORT PANEL (Phase 10) - Export the roster
// ============================================================
// Role matrix (button visibility via data-role-show + client guard):
//   Image (PNG) + PDF (Print):  everyone, including public viewers
//   CSV player list + JSON backup: moderators+ only
// JSON reuses /api/backup (auth header); everything else is generated
// locally in the browser - no server round-trip, no external libraries.
// ============================================================

var ExportPanel = {};

// ---- small helpers ----

function _exportDate() {
    return new Date().toISOString().slice(0, 10);
}

function _downloadBlob(content, filename, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

// Escape a cell for CSV (quotes, commas, newlines).
function _csvEscape(value) {
    var s = String(value == null ? '' : value);
    if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

function _dayLabel(day) {
    return day === 'sun' ? 'Sunday' : 'Saturday';
}

// ---- CSV player list (mod+) ----
// One row per player per day: master-list (guildMembers) entries with their
// placement in groups/reserves where applicable. A player appears once per day.
function exportRosterCSV() {
    if (typeof AuthModule === 'undefined' || !AuthModule.isMod()) {
        if (typeof showToast === 'function') showToast('CSV export is for moderators+ only.', 'error', 2500);
        return;
    }
    
    var rows = [['Day', 'Name', 'Class', 'Role', 'Location']];
    
    ['sat', 'sun'].forEach(function(day) {
        var seen = {};
        var groupPlayers = {}; // name|class|role -> location string
        
        // Placement lookup from groups and reserves for this day.
        var groups = (window.groups && window.groups[day]) || {};
        Object.keys(groups).forEach(function(key) {
            var g = groups[key] || {};
            var title = g.title || key;
            (g.players || []).forEach(function(p) {
                if (!p || !p.name) return;
                groupPlayers[p.name + '|' + (p.class || '') + '|' + (p.role || '')] = 'Group: ' + title;
            });
        });
        var reserves = (window.reserves && window.reserves[day]) || [];
        reserves.forEach(function(p) {
            if (!p || !p.name) return;
            var k = p.name + '|' + (p.class || '') + '|' + (p.role || '');
            if (!groupPlayers[k]) groupPlayers[k] = 'Reserve';
        });
        
        // Master list first (the canonical player list).
        var gm = (window.guildMembers && window.guildMembers[day]) || [];
        gm.forEach(function(p) {
            if (!p || !p.name) return;
            var k = p.name + '|' + (p.class || '') + '|' + (p.role || '');
            if (seen[k]) return;
            seen[k] = true;
            rows.push([_dayLabel(day), p.name, p.class || '', p.role || '', groupPlayers[k] || 'Master List']);
        });
        // Any group/reserve player not in the master list (edge case).
        Object.keys(groupPlayers).forEach(function(k) {
            if (seen[k]) return;
            seen[k] = true;
            var parts = k.split('|');
            rows.push([_dayLabel(day), parts[0], parts[1] || '', parts[2] || '', groupPlayers[k]]);
        });
    });
    
    var csv = rows.map(function(r) { return r.map(_csvEscape).join(','); }).join('\r\n');
    // BOM so Excel opens UTF-8 names correctly.
    _downloadBlob('\ufeff' + csv, 'guild-war-players-' + _exportDate() + '.csv', 'text/csv;charset=utf-8');
    if (typeof showToast === 'function') showToast('CSV player list downloaded', 'success', 1500);
}

// ---- Roster image (PNG) - everyone ----
// Rendered locally to a canvas (no screenshot library needed): title, date,
// then per day the groups, reserves, and guild-member list.
function exportRosterImage() {
    try {
        var W = 1400;
        var PAD = 40;
        var ctx = document.createElement('canvas').getContext('2d');
        var dayNames = { sat: 'SATURDAY', sun: 'SUNDAY' };
        
        // Build the line model first so the canvas height is exact.
        var lines = [];
        var push = function(text, font, color, h, indent, padTop) {
            lines.push({ text: text, font: font, color: color, h: h, indent: indent || 0, padTop: padTop || 0 });
        };
        
        var nameList = function(arr) {
            return (arr || []).map(function(p) { return p && p.name ? p.name : ''; }).filter(Boolean);
        };
        
        // Wrap long comma-joined lists into lines that fit the width.
        var wrapNames = function(names, font, h, indent) {
            if (names.length === 0) {
                push('— empty —', '16px system-ui', '#94a3b8', 26, indent);
                return;
            }
            ctx.font = font;
            var maxChars = Math.max(40, Math.floor((W - PAD * 2 - indent * 26) / (ctx.measureText('m').width)));
            var current = '';
            names.forEach(function(n) {
                var piece = (current ? ', ' : '• ') + n;
                if (current && current.length + piece.length > maxChars) {
                    push(current, font, '#cbd5e1', h, indent);
                    current = '• ' + n;
                } else {
                    current += piece;
                }
            });
            if (current) push(current, font, '#cbd5e1', h, indent);
        };
        
        push((window.guildName || 'Mask Sinners') + ' — Guild War Roster', 'bold 34px system-ui', '#f8fafc', 52, 0, 8);
        push('Generated ' + new Date().toLocaleString(), '18px system-ui', '#94a3b8', 30);
        
        ['sat', 'sun'].forEach(function(day) {
            push(dayNames[day], 'bold 26px system-ui', '#f5c542', 36, 0, 22);
            
            var groups = (window.groups && window.groups[day]) || {};
            Object.keys(groups).forEach(function(key) {
                var g = groups[key] || {};
                var title = g.title || key;
                var players = nameList(g.players);
                push(title + ' (' + players.length + ')', 'bold 20px system-ui', '#e2e8f0', 30, 1);
                wrapNames(players, '17px system-ui', 28, 2);
            });
            
            var reserves = nameList(window.reserves && window.reserves[day]);
            push('Reserves (' + reserves.length + ')', 'bold 20px system-ui', '#e2e8f0', 30, 1);
            wrapNames(reserves, '17px system-ui', 28, 2);
            
            var gm = nameList(window.guildMembers && window.guildMembers[day]);
            push('Guild Members (' + gm.length + ')', 'bold 20px system-ui', '#e2e8f0', 30, 1);
            if (gm.length === 0) {
                wrapNames([], '17px system-ui', 28, 2);
            } else {
                // Fixed-width columns for the master list.
                var perLine = 4;
                for (var i = 0; i < gm.length; i += perLine) {
                    var row = gm.slice(i, i + perLine).map(function(n) {
                        return (n.length > 24 ? n.slice(0, 24) : n).padEnd(24);
                    }).join('   ');
                    push(row, '17px ui-monospace, monospace', '#cbd5e1', 28, 2);
                }
            }
        });
        
        var H = PAD * 2;
        lines.forEach(function(l) { H += l.h + l.padTop; });
        
        var canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, W, H);
        
        var y = PAD;
        lines.forEach(function(l) {
            y += l.padTop;
            ctx.font = l.font;
            ctx.fillStyle = l.color;
            ctx.fillText(l.text, PAD + l.indent * 26, y + l.h * 0.75);
            y += l.h;
        });
        
        var dataUrl = canvas.toDataURL('image/png');
        var a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'guild-war-roster-' + _exportDate() + '.png';
        document.body.appendChild(a);
        a.click();
        a.remove();
        if (typeof showToast === 'function') showToast('Roster image downloaded', 'success', 1500);
    } catch (error) {
        console.error('Image export error:', error);
        if (typeof showToast === 'function') showToast('Failed to generate image.', 'error', 2500);
    }
}

// ---- PDF (native print dialog -> Save as PDF) - everyone ----
function exportRosterPDF() {
    window.print();
}

// ---- JSON full backup (mod+) ----
// Reuses the auth-header download from api.js (Phase 8.4).
function exportJsonBackup() {
    if (typeof AuthModule === 'undefined' || !AuthModule.getToken()) {
        if (typeof showToast === 'function') showToast('Please login to download a backup.', 'error', 2500);
        return;
    }
    if (typeof downloadBackup === 'function') {
        downloadBackup();
    } else {
        if (typeof showToast === 'function') showToast('Backup is unavailable right now.', 'error', 2500);
    }
}

// ---- wiring ----
ExportPanel.init = function() {
    var pdfBtn = document.getElementById('exportPdfBtn');
    var imgBtn = document.getElementById('exportImageBtn');
    var csvBtn = document.getElementById('exportCsvBtn');
    var jsonBtn = document.getElementById('exportJsonBtn');
    
    if (pdfBtn) pdfBtn.addEventListener('click', exportRosterPDF);
    if (imgBtn) imgBtn.addEventListener('click', exportRosterImage);
    if (csvBtn) csvBtn.addEventListener('click', exportRosterCSV);
    if (jsonBtn) jsonBtn.addEventListener('click', exportJsonBackup);
};

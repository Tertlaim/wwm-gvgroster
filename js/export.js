// ============================================================
// EXPORT PANEL (Phase 10 + 10B) - Export/import the roster
// ============================================================
// Role matrix (button visibility via data-role-show + client guards):
//   Image (PNG) + PDF (Print):       everyone, including public viewers
//   CSV player list (Help panel):    moderators+
//   JSON backup:                     admins+
//   Guild member CSV export/import:  admins+ (buttons near the Guild panel)
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

function _downloadDataUrl(dataUrl, filename) {
    var a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

function _csvEscape(value) {
    var s = String(value == null ? '' : value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

function _dayLabel(day) {
    return day === 'sun' ? 'Sunday' : 'Saturday';
}

function _playerName(p) {
    return p && p.name ? p.name : '';
}

// Deduped master list across both days (they are the same list).
function _guildMasterList() {
    var seen = {};
    var out = [];
    ['sat', 'sun'].forEach(function(day) {
        var gm = (window.guildMembers && window.guildMembers[day]) || [];
        gm.forEach(function(p) {
            if (!p || !p.name) return;
            var k = p.name + '|' + (p.class || '');
            if (seen[k]) return;
            seen[k] = true;
            out.push({ name: p.name, class: p.class || '', role: p.role || 'Member' });
        });
    });
    return out;
}

// ============================================================
// CSV: full player list (mod+) - Help panel button
// ============================================================
function exportRosterCSV() {
    if (typeof AuthModule === 'undefined' || !AuthModule.isMod()) {
        if (typeof showToast === 'function') showToast('CSV export is for moderators+ only.', 'error', 2500);
        return;
    }
    
    var rows = [['Day', 'Name', 'Class', 'Role', 'Location']];
    
    ['sat', 'sun'].forEach(function(day) {
        var seen = {};
        var groupPlayers = {};
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
        
        var gm = (window.guildMembers && window.guildMembers[day]) || [];
        gm.forEach(function(p) {
            if (!p || !p.name) return;
            var k = p.name + '|' + (p.class || '') + '|' + (p.role || '');
            if (seen[k]) return;
            seen[k] = true;
            rows.push([_dayLabel(day), p.name, p.class || '', p.role || '', groupPlayers[k] || 'Master List']);
        });
        Object.keys(groupPlayers).forEach(function(k) {
            if (seen[k]) return;
            seen[k] = true;
            var parts = k.split('|');
            rows.push([_dayLabel(day), parts[0], parts[1] || '', parts[2] || '', groupPlayers[k]]);
        });
    });
    
    var csv = rows.map(function(r) { return r.map(_csvEscape).join(','); }).join('\r\n');
    _downloadBlob('\ufeff' + csv, 'guild-war-players-' + _exportDate() + '.csv', 'text/csv;charset=utf-8');
    if (typeof showToast === 'function') showToast('CSV player list downloaded', 'success', 1500);
}

// ============================================================
// CSV: guild member list only (admin+) - near the Guild panel
// Name,Class,Role so it round-trips through Excel.
// ============================================================
function exportGuildCsv() {
    if (typeof AuthModule === 'undefined' || !AuthModule.isAdmin()) {
        if (typeof showToast === 'function') showToast('Guild CSV export is for admins only.', 'error', 2500);
        return;
    }
    var rows = [['Name', 'Class', 'Role']];
    _guildMasterList().forEach(function(p) {
        rows.push([p.name, p.class, p.role]);
    });
    var csv = rows.map(function(r) { return r.map(_csvEscape).join(','); }).join('\r\n');
    _downloadBlob('\ufeff' + csv, 'guild-members-' + _exportDate() + '.csv', 'text/csv;charset=utf-8');
    if (typeof showToast === 'function') showToast('Guild member CSV downloaded', 'success', 1500);
}

// ============================================================
// IMAGE: roster PNG (everyone) - two-column days, one guild list
// ============================================================
function exportRosterImage() {
    try {
        var W = 1400;
        var PAD = 40;
        var GUTTER = 40;
        var COLW = (W - PAD * 2 - GUTTER) / 2; // 640
        var ctx = document.createElement('canvas').getContext('2d');
        var dayNames = { sat: 'SATURDAY', sun: 'SUNDAY' };
        
        var buildCol = function(day) {
            var lines = [];
            var push = function(text, font, color, h, indent) {
                lines.push({ text: text, font: font, color: color, h: h, indent: indent || 0 });
            };
            var names = function(arr) {
                return (arr || []).map(_playerName).filter(Boolean);
            };
            var wrapNames = function(list, font, h, indent) {
                if (list.length === 0) { push('— empty —', '16px system-ui', '#94a3b8', 26, indent); return; }
                ctx.font = font;
                var maxChars = Math.max(30, Math.floor((COLW - indent * 20) / ctx.measureText('m').width));
                var current = '';
                list.forEach(function(n) {
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
            
            push(dayNames[day], 'bold 26px system-ui', '#f5c542', 36, 0);
            
            var groups = (window.groups && window.groups[day]) || {};
            Object.keys(groups).forEach(function(key) {
                var g = groups[key] || {};
                var title = g.title || key;
                var players = names(g.players);
                push(title + ' (' + players.length + ')', 'bold 19px system-ui', '#e2e8f0', 30, 1);
                wrapNames(players, '16px system-ui', 27, 2);
            });
            
            var reserves = names(window.reserves && window.reserves[day]);
            push('Reserves (' + reserves.length + ')', 'bold 19px system-ui', '#e2e8f0', 30, 1);
            wrapNames(reserves, '16px system-ui', 27, 2);
            
            return lines;
        };
        
        var colSat = buildCol('sat');
        var colSun = buildCol('sun');
        var colH = function(lines) { return lines.reduce(function(s, l) { return s + l.h + (l.padTop || 0); }, 0); };
        
        // Guild master list: ONE table (both days share the same players).
        var guild = _guildMasterList();
        var guildLines = [];
        guildLines.push({ text: 'Guild Members (' + guild.length + ')', font: 'bold 24px system-ui', color: '#f8fafc', h: 34, padTop: 30 });
        var perLine = 5;
        for (var i = 0; i < guild.length; i += perLine) {
            var row = guild.slice(i, i + perLine).map(function(p) {
                var s = p.name + (p.class ? ' (' + p.class + ')' : '');
                return (s.length > 22 ? s.slice(0, 22) : s).padEnd(22);
            }).join('   ');
            guildLines.push({ text: row, font: '16px ui-monospace, monospace', color: '#cbd5e1', h: 27 });
        }
        
        var topH = Math.max(colH(colSat), colH(colSun));
        var H = PAD + topH + colH(guildLines) + PAD;
        
        var canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, W, H);
        
        var drawCol = function(lines, x) {
            var y = PAD;
            lines.forEach(function(l) {
                y += l.padTop || 0;
                ctx.font = l.font;
                ctx.fillStyle = l.color;
                ctx.fillText(l.text, x + l.indent * 20, y + l.h * 0.75);
                y += l.h;
            });
        };
        drawCol(colSat, PAD);
        drawCol(colSun, PAD + COLW + GUTTER);
        var gy = PAD + topH;
        guildLines.forEach(function(l) {
            gy += l.padTop || 0;
            ctx.font = l.font;
            ctx.fillStyle = l.color;
            ctx.fillText(l.text, PAD, gy + l.h * 0.75);
            gy += l.h;
        });
        
        _downloadDataUrl(canvas.toDataURL('image/png'), 'guild-war-roster-' + _exportDate() + '.png');
        if (typeof showToast === 'function') showToast('Roster image downloaded', 'success', 1500);
    } catch (error) {
        console.error('Image export error:', error);
        if (typeof showToast === 'function') showToast('Failed to generate image.', 'error', 2500);
    }
}

// ============================================================
// PDF: dedicated printable roster (everyone)
//   Page 1: Saturday (groups + reserves)
//   Page 2: Sunday (groups + reserves)
//   Following pages: Guild Members (master list table)
// The app itself (incl. the Register panel) is hidden in print.
// ============================================================
function exportRosterPDF() {
    try {
        var el = document.getElementById('printRoster');
        if (!el) { window.print(); return; }
        
        var esc = typeof window.esc === 'function' ? window.esc : function(s) {
            return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };
        var html = '';
        html += '<h1>' + esc(window.guildName || 'Mask Sinners') + ' — Guild War Roster</h1>';
        html += '<p class="print-sub">Generated ' + esc(new Date().toLocaleString()) + '</p>';
        
        var dayNames = { sat: 'Saturday', sun: 'Sunday' };
        var first = true;
        ['sat', 'sun'].forEach(function(day) {
            html += '<div' + (first ? '' : ' class="print-day-break"') + '>';
            html += '<h2>' + dayNames[day] + '</h2>';
            var groups = (window.groups && window.groups[day]) || {};
            Object.keys(groups).forEach(function(key) {
                var g = groups[key] || {};
                var title = g.title || key;
                var players = (g.players || []).map(_playerName).filter(Boolean);
                html += '<h3>' + esc(title) + ' (' + players.length + ')</h3>';
                html += players.length
                    ? '<ul>' + players.map(function(n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>'
                    : '<div class="print-empty">— empty —</div>';
            });
            var reserves = (window.reserves && window.reserves[day]) || [];
            var reserveNames = reserves.map(_playerName).filter(Boolean);
            html += '<h3>Reserves (' + reserveNames.length + ')</h3>';
            html += reserveNames.length
                ? '<ul>' + reserveNames.map(function(n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>'
                : '<div class="print-empty">— empty —</div>';
            html += '</div>';
            first = false;
        });
        
        // Guild Members master list on its own page(s); flows naturally.
        var guild = _guildMasterList();
        html += '<div class="print-day-break">';
        html += '<h2>Guild Members (' + guild.length + ')</h2>';
        if (guild.length) {
            html += '<table style="border-collapse:collapse; width:100%; font-size:12px;">';
            html += '<thead><tr style="border-bottom:1px solid #333;"><th style="text-align:left; padding:3px 8px;">Name</th><th style="text-align:left; padding:3px 8px;">Class</th><th style="text-align:left; padding:3px 8px;">Role</th></tr></thead><tbody>';
            guild.forEach(function(p) {
                html += '<tr style="border-bottom:1px solid #ccc;"><td style="padding:3px 8px;">' + esc(p.name) + '</td><td style="padding:3px 8px;">' + esc(p.class) + '</td><td style="padding:3px 8px;">' + esc(p.role) + '</td></tr>';
            });
            html += '</tbody></table>';
        } else {
            html += '<div class="print-empty">— empty —</div>';
        }
        html += '</div>';
        
        el.innerHTML = html;
        window.print();
    } catch (error) {
        console.error('PDF export error:', error);
        if (typeof showToast === 'function') showToast('Failed to prepare print view.', 'error', 2500);
    }
}

// ============================================================
// JSON full backup (admin+) - reuses the auth-header download
// ============================================================
function exportJsonBackup() {
    if (typeof AuthModule === 'undefined' || !AuthModule.isAdmin()) {
        if (typeof showToast === 'function') showToast('Only admins can download a backup.', 'error', 2500);
        return;
    }
    if (typeof downloadBackup === 'function') downloadBackup();
}

// ============================================================
// CSV import of guild members (admin+) - file upload or paste
// ============================================================

var VALID_CLASSES = ['Tank', 'DPS', 'Heal'];
var VALID_ROLES = ['Member', 'Commander', 'Vice Commander', 'Healer'];

// Parse CSV text (handles quoted fields) into rows of cells.
function _parseCsvRows(text) {
    var rows = [];
    var row = [];
    var cell = '';
    var inQuotes = false;
    var s = String(text || '');
    for (var i = 0; i < s.length; i++) {
        var c = s[i];
        if (inQuotes) {
            if (c === '"') {
                if (s[i + 1] === '"') { cell += '"'; i++; }
                else inQuotes = false;
            } else {
                cell += c;
            }
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(cell); cell = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && s[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.some(function(x) { return x.trim() !== ''; })) rows.push(row);
            row = [];
        } else {
            cell += c;
        }
    }
    row.push(cell);
    if (row.some(function(x) { return x.trim() !== ''; })) rows.push(row);
    return rows;
}

// Read the import source (file or textarea) into parsed rows, skipping a header line.
function _readImportRows() {
    var text = document.getElementById('guildImportText').value.trim();
    var fileInput = document.getElementById('guildImportFile');
    if (fileInput && fileInput.files && fileInput.files[0] && !text) {
        // Synchronous-ish read is not possible; handled by the caller via FileReader.
        return null;
    }
    var rows = _parseCsvRows(text);
    if (rows.length && /^name\s*$/i.test(rows[0][0])) rows.shift(); // skip header
    return rows;
}

function _normalizeImportRow(cells) {
    var name = (cells[0] || '').trim();
    var cls = (cells[1] || '').trim() || 'DPS';
    var role = (cells[2] || '').trim() || 'Member';
    if (!name) return { error: 'Empty name' };
    if (name.length > 20) return { error: 'Name too long: ' + name };
    if (/[<>]/.test(name)) return { error: 'Invalid chars in name: ' + name };
    if (VALID_CLASSES.indexOf(cls) === -1) return { error: 'Bad class "' + cls + '" for ' + name };
    if (VALID_ROLES.indexOf(role) === -1) return { error: 'Bad role "' + role + '" for ' + name };
    return { name: name, class: cls, role: role };
}

function _showImportPreview() {
    var rows = _readImportRows();
    var preview = document.getElementById('guildImportPreview');
    if (rows === null) {
        // File selected: read it async and re-render the preview.
        var fileInput = document.getElementById('guildImportFile');
        var file = fileInput.files[0];
        var reader = new FileReader();
        reader.onload = function() {
            document.getElementById('guildImportText').value = String(reader.result || '');
            _showImportPreview();
        };
        reader.readAsText(file);
        return;
    }
    var parsed = rows.map(_normalizeImportRow);
    var ok = parsed.filter(function(r) { return !r.error; });
    var bad = parsed.filter(function(r) { return r.error; });
    var existing = 0;
    var seen = {};
    var days = [];
    if (document.getElementById('guildImportSat').checked) days.push('sat');
    if (document.getElementById('guildImportSun').checked) days.push('sun');
    
    // Dedupe within the file + against current guild members.
    ok = ok.filter(function(p) {
        var k = p.name + '|' + p.class;
        if (seen[k]) return false;
        seen[k] = true;
        var dayHas = days.some(function(day) {
            return ((window.guildMembers && window.guildMembers[day]) || []).some(function(g) {
                return g && g.name === p.name && (g.class || '') === p.class;
            });
        });
        if (dayHas) { existing++; return false; }
        return true;
    });
    
    preview.textContent = 'Preview: ' + ok.length + ' new players will be added'
        + (days.length === 2 ? ' to BOTH days' : days.length === 1 ? ' to ' + _dayLabel(days[0]) : '')
        + (existing ? '. ' + existing + ' already exist (skipped).' : '')
        + (bad.length ? '\nSkipped ' + bad.length + ' bad row(s):\n' + bad.slice(0, 5).map(function(b) { return '• ' + b.error; }).join('\n') : '');
}

function _applyGuildImport() {
    if (typeof AuthModule === 'undefined' || !AuthModule.isAdmin()) {
        if (typeof showToast === 'function') showToast('Only admins can import guild members.', 'error', 2500);
        return;
    }
    var rows = _readImportRows();
    if (rows === null) {
        // File selected: read it, then apply.
        var fileInput = document.getElementById('guildImportFile');
        var reader = new FileReader();
        reader.onload = function() {
            document.getElementById('guildImportText').value = String(reader.result || '');
            _applyGuildImport();
        };
        reader.readAsText(fileInput.files[0]);
        return;
    }
    
    var days = [];
    if (document.getElementById('guildImportSat').checked) days.push('sat');
    if (document.getElementById('guildImportSun').checked) days.push('sun');
    if (days.length === 0) {
        if (typeof showToast === 'function') showToast('Select at least one day.', 'error', 2500);
        return;
    }
    
    var parsed = rows.map(_normalizeImportRow).filter(function(r) { return !r.error; });
    var seen = {};
    parsed = parsed.filter(function(p) {
        var k = p.name + '|' + p.class;
        if (seen[k]) return false;
        seen[k] = true;
        return true;
    });
    
    if (parsed.length === 0) {
        if (typeof showToast === 'function') showToast('No valid players to import.', 'error', 2500);
        return;
    }
    
    var added = 0;
    var skippedExisting = 0;
    days.forEach(function(day) {
        if (!window.guildMembers) window.guildMembers = {};
        if (!Array.isArray(window.guildMembers[day])) window.guildMembers[day] = [];
        var list = window.guildMembers[day];
        parsed.forEach(function(p) {
            var exists = list.some(function(g) { return g && g.name === p.name && (g.class || '') === p.class; });
            if (exists) { skippedExisting++; return; }
            if (list.length >= 30) return; // hard cap per list
            list.push({
                id: 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                name: p.name,
                class: p.class,
                role: p.role
            });
            added++;
        });
    });
    
    if (added === 0 && skippedExisting === 0) {
        if (typeof showToast === 'function') showToast('Nothing to import (list full or all duplicates).', 'error', 2500);
        return;
    }
    
    // History + save through the normal pipeline.
    if (typeof History !== 'undefined' && History.add) {
        History.add('import', {
            details: 'CSV import: ' + added + ' guild member(s) added' + (skippedExisting ? ', ' + skippedExisting + ' already existed' : '')
        });
    }
    if (typeof updateLastUpdate === 'function') updateLastUpdate();
    if (typeof render === 'function') render();
    if (typeof saveState === 'function') saveState();
    
    if (typeof showToast === 'function') showToast('Imported ' + added + ' guild member(s).', 'success', 2500);
    _closeGuildImport();
}

function _openGuildImport() {
    var modal = document.getElementById('guildImportModal');
    if (!modal) return;
    document.getElementById('guildImportFile').value = '';
    document.getElementById('guildImportText').value = '';
    document.getElementById('guildImportPreview').textContent = '';
    document.getElementById('guildImportSat').checked = true;
    document.getElementById('guildImportSun').checked = true;
    modal.classList.add('active');
}

function _closeGuildImport() {
    var modal = document.getElementById('guildImportModal');
    if (modal) modal.classList.remove('active');
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
    
    // Guild member CSV tools (admin+)
    var gExp = document.getElementById('guildCsvExportBtn');
    var gImp = document.getElementById('guildCsvImportBtn');
    if (gExp) gExp.addEventListener('click', exportGuildCsv);
    if (gImp) gImp.addEventListener('click', _openGuildImport);
    
    var applyBtn = document.getElementById('guildImportApplyBtn');
    var cancelBtn = document.getElementById('guildImportCancelBtn');
    if (applyBtn) applyBtn.addEventListener('click', _applyGuildImport);
    if (cancelBtn) cancelBtn.addEventListener('click', _closeGuildImport);
    
    var fileInput = document.getElementById('guildImportFile');
    var textArea = document.getElementById('guildImportText');
    var satChk = document.getElementById('guildImportSat');
    var sunChk = document.getElementById('guildImportSun');
    [fileInput, textArea, satChk, sunChk].forEach(function(el) {
        if (el) el.addEventListener('input', _showImportPreview);
    });
};

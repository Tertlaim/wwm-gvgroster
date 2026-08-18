// ============================================================
//  UTIL - Shared utilities (Phase 11.3)
//  Single home for helpers previously duplicated across
//  api.js / export.js / helper.js. Load this file first.
// ============================================================

// ---- HTML escaping (prevents stored XSS via player names / notes / history) ----
function esc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ---- Auth token helper (Phase 4.4) ----
function getAuthHeader() {
    const token = typeof AuthModule !== 'undefined' && AuthModule.getToken ? AuthModule.getToken() : null;
    return token ? { 'Authorization': 'Bearer ' + token } : {};
}

// ---- Download helpers ----
function downloadBlob(content, filename, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

function downloadDataUrl(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

// ---- CSV helpers (shared by export + import) ----
function csvEscape(value) {
    const s = String(value == null ? '' : value);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
}

// Parse CSV text into rows of cells, handling quoted cells, escaped quotes,
// and CRLF/LF line endings. Empty rows are dropped.
function parseCSVRows(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    const s = String(text || '');
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
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

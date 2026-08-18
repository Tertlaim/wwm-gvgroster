// server/util.js - Shared low-level utilities (Phase 11.1)

// ============================================
// ATOMIC FILE WRITES (Phase 8.1)
// ============================================
// Write via a temp file + rename so a crash mid-write can never leave a
// truncated/partial JSON file on disk (the rename is atomic on POSIX and
// replace-on-rename on Windows).
const fs = require('fs');

function atomicWriteFileSync(filePath, data) {
    const tmpPath = filePath + '.tmp';
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
}

module.exports = { atomicWriteFileSync };

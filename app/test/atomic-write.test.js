// test/atomic-write.test.js - Phase 11.8: atomic write via temp + rename
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { atomicWriteFileSync } = require('../server/util');

test('writes a complete valid file with no .tmp leftover', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwar-atomic-'));
    const file = path.join(dir, 'db.json');
    try {
        atomicWriteFileSync(file, JSON.stringify({ a: 1, nested: { b: [1, 2, 3] } }));
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.deepStrictEqual(parsed, { a: 1, nested: { b: [1, 2, 3] } });
        assert.deepStrictEqual(fs.readdirSync(dir), ['db.json'], 'no temp file may remain');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('overwrite replaces the previous content atomically', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwar-atomic2-'));
    const file = path.join(dir, 'db.json');
    try {
        atomicWriteFileSync(file, JSON.stringify({ version: 1 }));
        atomicWriteFileSync(file, JSON.stringify({ version: 2 }));
        assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2);
        assert.deepStrictEqual(fs.readdirSync(dir), ['db.json'], 'still no temp file');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('large payload round-trips intact', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gwar-atomic3-'));
    const file = path.join(dir, 'db.json');
    try {
        const big = { players: [] };
        for (let i = 0; i < 2000; i++) big.players.push({ id: 'p' + i, name: 'Player ' + i, class: 'DPS' });
        atomicWriteFileSync(file, JSON.stringify(big));
        const reparsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.strictEqual(reparsed.players.length, 2000);
        assert.strictEqual(reparsed.players[1999].name, 'Player 1999');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

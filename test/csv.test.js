// test/csv.test.js - Phase 11.8: shared client utils (parseCSVRows/csvEscape/esc)
const test = require('node:test');
const assert = require('node:assert');
const { esc, csvEscape, parseCSVRows } = require('../js/util.js');

test('parses simple CSV rows', () => {
    assert.deepStrictEqual(parseCSVRows('a,b\nc,d'), [['a', 'b'], ['c', 'd']]);
});

test('handles quoted cells containing commas', () => {
    const rows = parseCSVRows('"Antony, Jr",Tank,Vice Commander\nBayu,DPS,Commander');
    assert.strictEqual(rows[0][0], 'Antony, Jr');
    assert.strictEqual(rows[1][0], 'Bayu');
});

test('handles escaped quotes inside quoted cells', () => {
    const rows = parseCSVRows('"say ""hi""",x');
    assert.strictEqual(rows[0][0], 'say "hi"');
});

test('handles CRLF and LF line endings', () => {
    assert.strictEqual(parseCSVRows('a,b\r\nc,d\r\n').length, 2);
    assert.strictEqual(parseCSVRows('a,b\nc,d\n').length, 2);
    assert.strictEqual(parseCSVRows('a,b\r\nc,d').length, 2, 'CRLF must not split into extra rows');
});

test('drops empty rows', () => {
    assert.deepStrictEqual(parseCSVRows('a,b\n\n\nc,d\n'), [['a', 'b'], ['c', 'd']]);
});

test('empty/blank input yields no rows', () => {
    assert.deepStrictEqual(parseCSVRows(''), []);
    assert.deepStrictEqual(parseCSVRows('\n\n'), []);
    assert.deepStrictEqual(parseCSVRows(null), []);
});

test('csvEscape quotes only when needed and doubles embedded quotes', () => {
    assert.strictEqual(csvEscape('plain'), 'plain');
    assert.strictEqual(csvEscape('with,comma'), '"with,comma"');
    assert.strictEqual(csvEscape('say "hi"'), '"say ""hi"""');
    assert.strictEqual(csvEscape('multi\nline'), '"multi\nline"');
    assert.strictEqual(csvEscape(null), '');
    assert.strictEqual(csvEscape(42), '42');
});

test('esc neutralizes XSS characters', () => {
    assert.strictEqual(esc('<script>alert("x")</script>'),
        '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    assert.strictEqual(esc("it's"), 'it&#39;s');
    assert.strictEqual(esc('A&B'), 'A&amp;B');
    assert.strictEqual(esc(null), '');
    assert.strictEqual(esc(0), '0');
});

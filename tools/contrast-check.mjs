// tools/contrast-check.mjs - WCAG AA contrast audit for the theme variables
// Usage: node tools/contrast-check.mjs
// Parses css/variable.css (:root = dark theme, [data-theme="light"]) and
// checks the fg/bg pairings the UI actually renders. Thresholds: 4.5:1 for
// normal text, 3:1 for large text / non-text UI.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'css', 'variable.css');
const css = readFileSync(cssPath, 'utf8');

function parseVars(block) {
    const vars = {};
    const re = /--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
    let m;
    while ((m = re.exec(block)) !== null) vars[m[1]] = m[2].toLowerCase();
    return vars;
}

const darkBlock = css.slice(css.indexOf(':root'), css.indexOf('[data-theme="light"]'));
const lightBlock = css.slice(css.indexOf('[data-theme="light"]'), css.indexOf('/* ===== SCROLLBAR'));
const themes = { dark: parseVars(darkBlock), light: parseVars(lightBlock) };

function lum(hex) {
    const c = [0, 2, 4].map(i => parseInt(hex.slice(1 + i, 3 + i), 16) / 255)
        .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(fg, bg) {
    const l1 = lum(fg), l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// Real render pairings: [description, fgVarOrHex, bgVarOrHex, threshold]
function pairsFor(t) {
    const v = themes[t];
    const P = [];
    const surface = ['bg-body', 'bg-app', 'bg-card', 'bg-panel', 'bg-input', 'bg-hover', 'bg-active'];
    for (const s of surface) {
        P.push([`text-primary on ${s}`, v['text-primary'], v[s], 4.5]);
        P.push([`text-secondary on ${s}`, v['text-secondary'], v[s], 4.5]);
        P.push([`text-muted on ${s}`, v['text-muted'], v[s], 4.5]);
    }
    // Accent colors used as text/icons on panels and cards.
    // accent-red is background/border-only since the split: its TEXT/ICON
    // usages now go through --accent-red-soft (checked separately below).
    for (const a of ['accent-gold', 'accent-blue', 'accent-green', 'accent-red-soft', 'accent-amber', 'accent-purple']) {
        P.push([`${a} as text on bg-panel`, v[a], v['bg-panel'], 4.5]);
        P.push([`${a} as icon on bg-card`, v[a], v['bg-card'], 3.0]);
    }
    // Accent surfaces with their label/text colors (buttons, pills)
    P.push(['text-inverse on accent-gold (buttons)', v['text-inverse'], v['accent-gold'], 4.5]);
    P.push(['white on accent-red (.btn-danger)', '#ffffff', v['accent-red'], 4.5]);
    P.push(['text-inverse on accent-blue (.btn-login)', v['text-inverse'], v['accent-blue'], 4.5]);
    P.push(['text-inverse on accent-green (role pill)', v['text-inverse'], v['accent-green'], 4.5]);
    P.push(['text-inverse on accent-purple (role pill)', v['text-inverse'], v['accent-purple'], 4.5]);
    P.push(['text-inverse on accent-amber', v['text-inverse'], v['accent-amber'], 4.5]);
    return P;
}

let fail = 0;
for (const t of Object.keys(themes)) {
    console.log(`\n=== ${t.toUpperCase()} THEME ===`);
    for (const [name, fg, bg, min] of pairsFor(t)) {
        if (!fg || !bg) { console.log(`SKIP  ${name} (missing var)`); continue; }
        const r = ratio(fg, bg);
        const ok = r >= min;
        if (!ok) fail++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}  (min ${min})  ${name}  ${fg} / ${bg}`);
    }
}
console.log(`\n${fail} failing pair(s)`);
process.exit(0);

#!/usr/bin/env node
// CI schema + sanity gate for values.json.
// Usage: node validate.js <new-values.json> [old-values.json]
// Exits 0 on pass, 1 on any failure. Run BEFORE committing; never commit on exit 1.
'use strict';

const fs = require('fs');

// The 14 canonical tank names (lower-case, * stripped).
const BUILT_INS = new Set([
  'super','triple railgun','artemis','ultra','omega','suppress',
  'atomic','leopard','epsilon','snowflake','turtle','allspiker','mammoth','sidecluster',
]);

const norm = (s) => String(s ?? '').replace(/\*$/, '').trim().toLowerCase();

const [,, newPath, oldPath] = process.argv;
if (!newPath) { console.error('usage: node validate.js <new.json> [old.json]'); process.exit(1); }

let arr;
try { arr = JSON.parse(fs.readFileSync(newPath, 'utf8')); }
catch (e) { console.error('parse error:', e.message); process.exit(1); }

// 1. Top-level shape
if (!Array.isArray(arr)) { console.error('FAIL: top-level value is not an array'); process.exit(1); }
if (arr.length === 0) { console.error('FAIL: empty array'); process.exit(1); }

// 2. Per-entry type guards
let errs = 0;
const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); errs++; } };

for (const e of arr) {
  if (!BUILT_INS.has(norm(e.name)))        ok(false, `unknown tank name "${e.name}"`);
  ok(typeof e.low === 'number'    && isFinite(e.low)    && e.low > 0,          `${e.name}.low must be a positive finite number (got ${e.low})`);
  ok(typeof e.high === 'number'   && isFinite(e.high)   && e.high > 0,         `${e.name}.high must be a positive finite number (got ${e.high})`);
  ok(typeof e.demand === 'number' && isFinite(e.demand) && e.demand >= 0,       `${e.name}.demand must be ≥ 0 (got ${e.demand})`);
  ok(typeof e.supply === 'number' && isFinite(e.supply) && e.supply >= 0,       `${e.name}.supply must be ≥ 0 (got ${e.supply})`);
  ok(typeof e.trend === 'number'  && isFinite(e.trend),                         `${e.name}.trend must be a finite number (got ${e.trend})`);
  if (typeof e.high === 'number' && typeof e.low === 'number' && e.high < e.low)
    console.warn('WARN:', `${e.name}.high < low — will be auto-swapped client-side`);
}

if (errs) { console.error(`\n${errs} error(s). Fix before committing.`); process.exit(1); }

// 3. Sanity bounds vs prior values (spike / bulk-change detection)
if (oldPath && fs.existsSync(oldPath)) {
  let old;
  try { old = JSON.parse(fs.readFileSync(oldPath, 'utf8')); } catch (_) { old = null; }
  if (Array.isArray(old) && old.length > 0) {
    const oldMap = new Map(old.map((e) => [norm(e.name), e]));

    // Single-tank spike: mid changed by > 500% vs prior — almost certainly a scrape error.
    const SPIKE = 5.0;
    // Bulk-change gate: if > 30% of tanks each moved by > 200%, treat as garbage scrape.
    const BULK_PER_TANK = 2.0;
    const BULK_FRAC     = 0.30;

    let bulkCount = 0;
    for (const e of arr) {
      const prior = oldMap.get(norm(e.name));
      if (!prior) continue;
      const oldMid = (prior.low + prior.high) / 2;
      const newMid = (e.low + e.high) / 2;
      const ratio  = newMid / oldMid;
      if (ratio > 1 + SPIKE || ratio < 1 / (1 + SPIKE)) {
        console.error(`FAIL: ${e.name} mid changed ${((ratio - 1) * 100).toFixed(0)}% — exceeds single-spike threshold (${SPIKE * 100}%). Likely a bad scrape.`);
        process.exit(1);
      }
      if (ratio > 1 + BULK_PER_TANK || ratio < 1 / (1 + BULK_PER_TANK)) bulkCount++;
    }
    if (bulkCount > arr.length * BULK_FRAC) {
      console.error(`FAIL: ${bulkCount}/${arr.length} tanks moved > ${BULK_PER_TANK * 100}% — exceeds bulk-change threshold (${(BULK_FRAC * 100).toFixed(0)}% of tanks). Likely a garbage scrape.`);
      process.exit(1);
    }
  }
}

console.log(`OK: ${arr.length} entries valid.${oldPath ? ' Spike/bulk checks passed.' : ''}`);
process.exit(0);

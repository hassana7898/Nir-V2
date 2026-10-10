// Verifies the SHIPPED mapServerInvoice (extracted verbatim from services/dataService.ts,
// type-stripped via esbuild) against the real /api/sync/state payload.
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const src = fs.readFileSync(path.join(__dirname, 'services', 'dataService.ts'), 'utf8');
const start = src.indexOf('const mapServerInvoice');
if (start < 0) { console.error('mapper not found'); process.exit(2); }
const t = src.indexOf('return exit as Exit;', start);
const end = src.indexOf('};', t) + 2;
const fnText = src.slice(start, end);

const js = esbuild.transformSync(fnText + '\nmodule.exports.__map = mapServerInvoice;', { loader: 'ts', format: 'cjs' }).code;
const coerceNum = (v) => { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : 0; };
const coerceMs = (v) => { if (v == null) return 0; if (typeof v === 'number') return v; const n = Date.parse(v); return Number.isFinite(n) ? n : 0; };
const mod = { exports: {} };
new Function('module', 'exports', 'coerceNum', 'coerceMs', js)(mod, mod.exports, coerceNum, coerceMs);
const mapServerInvoice = mod.exports.__map;

(async () => {
  const base = 'http://127.0.0.1:3000';
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'LocalTest!12345' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const r = await fetch(base + '/api/sync/state', { headers: { cookie } });
  const st = await r.json();
  const mapped = st.invoices.map(mapServerInvoice);

  let bad = 0, entries = 0, exits = 0;
  for (const m of mapped) {
    const hasSeller = Object.prototype.hasOwnProperty.call(m, 'sellerName');
    const hasFarmer = Object.prototype.hasOwnProperty.call(m, 'farmerId');
    if (m.type === 'entry') { entries++; if (!(hasSeller && !hasFarmer)) { bad++; if (bad <= 5) console.log('BAD entry', m.id, { hasSeller, hasFarmer }); } }
    else { exits++; if (!(!hasSeller && hasFarmer)) { bad++; if (bad <= 5) console.log('BAD exit', m.id, { hasSeller, hasFarmer }); } }
  }
  const asEntry = mapped.filter(i => 'sellerName' in i).length;
  const asExit = mapped.filter(i => 'farmerId' in i).length;
  console.log(JSON.stringify({ total: mapped.length, entries, exits, invariant_violations: bad, detected_entries_by_sellerName: asEntry, detected_exits_by_farmerId: asExit }));
  process.exit(bad === 0 && asEntry === entries && asExit === exits ? 0 : 1);
})().catch(e => { console.error('ERR', e.message); process.exit(3); });

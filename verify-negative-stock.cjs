// Verifies: an exit that exceeds available stock is ACCEPTED (201) and drives stock negative.
(async () => {
  const base = 'http://127.0.0.1:3000';
  const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'LocalTest!12345' }) });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
  console.log('login:', login.status, cookie ? '(cookie ok)' : '(NO COOKIE)');

  const prod = 'verify_neg_prod_1';
  const date = '2026-09-15';

  // Baseline stock (should be 0 / absent for a brand-new product).
  const before = await (await fetch(base + '/api/inventory/status?until=' + date, { headers: { cookie } })).json();
  console.log('stock before:', before.stock?.[prod] ?? 0);

  // Request an exit far beyond available stock -> must be ALLOWED now.
  const opId = 'negtest-' + Date.now();
  const body = { type: 'exit', date, productId: prod, productName: 'NegativeTest', farmerId: 'verify_neg_farmer_1', farmerName: 'تست منفی', weight: 500, invoiceNumber: 'NEG-1', driverName: '-' };
  const res = await fetch(base + '/api/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': opId, cookie }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  console.log('POST exit over-stock ->', res.status, JSON.stringify(j).slice(0, 200));

  const after = await (await fetch(base + '/api/inventory/status?until=' + date, { headers: { cookie } })).json();
  console.log('stock after:', after.stock?.[prod] ?? 0);

  // Also verify an update (PUT) of an exit is no longer blocked.
  const id = j?.data?.id || j?.id;
  let putStatus = 'n/a';
  if (id) {
    const put = await fetch(base + '/api/invoices/' + encodeURIComponent(id), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Operation-Id': 'negtest-upd-' + Date.now(), cookie }, body: JSON.stringify({ ...body, id, weight: 900 }) });
    putStatus = put.status;
  }
  console.log('PUT exit over-stock ->', putStatus);

  const after2 = await (await fetch(base + '/api/inventory/status?until=' + date, { headers: { cookie } })).json();
  console.log('stock after update:', after2.stock?.[prod] ?? 0);

  const pass = res.status === 201 && (after.stock?.[prod] ?? 0) < 0;
  console.log('NEGATIVE_INVENTORY_ALLOWED =', pass);
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERR', e.stack); process.exit(3); });

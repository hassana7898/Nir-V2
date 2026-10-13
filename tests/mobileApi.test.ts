process.env.NODE_ENV = 'test';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../server';
import { db } from '../server/db';
import { delivery_proofs, drivers, farmer_orders, farmers, invoices, otp_codes, products, users } from '../server/db/schema';
import { and, desc, eq, or } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { normalizePersianText } from '../shared/persianText';

test('Mobile API Endpoints Test Suite', async (t) => {
  // Start server on ephemeral port
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const testDriverPhone = '09129990001';
  const testFarmerPhone = '09129990002';
  const testDriverId = `test-drv-${Date.now()}`;
  const testFarmerId = `test-fmr-${Date.now()}`;
  const testAdminId = `test-adm-${Date.now()}`;
  const testPassword = 'AdminSecret123!';

  // Clean up any stale records from previous runs
  await db.delete(users).where(or(eq(users.phone, testDriverPhone), eq(users.username, testDriverPhone))).catch(() => {});
  await db.delete(users).where(or(eq(users.phone, testFarmerPhone), eq(users.username, testFarmerPhone))).catch(() => {});
  await db.delete(users).where(eq(users.username, 'mobile_admin_test')).catch(() => {});
  await db.delete(drivers).where(or(eq(drivers.name, 'علی راننده تست'), eq(drivers.phone, testDriverPhone))).catch(() => {});
  await db.delete(farmers).where(or(eq(farmers.name, 'مرغداری البرز تست'), eq(farmers.phone, testFarmerPhone))).catch(() => {});
  await db.delete(otp_codes).where(eq(otp_codes.phone, testDriverPhone)).catch(() => {});

  // Seed test records
  await db.insert(drivers).values({
    id: testDriverId,
    name: 'علی راننده تست',
    phone: testDriverPhone,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(farmers).values({
    id: testFarmerId,
    name: 'مرغداری البرز تست',
    phone: testFarmerPhone,
    broods: [
      { id: 'b1', name: 'دوره تابستان', startDate: '1404/05/01', flockCount: 15000 }
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  const passwordHash = await bcrypt.hash(testPassword, 10);
  await db.insert(users).values({
    id: testAdminId,
    username: 'mobile_admin_test',
    passwordHash,
    role: 'ADMIN',
    fullName: 'مدیر تست موبایل',
    is2faEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  await t.test('GET /api/mobile/meta returns versioning and server state', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/meta`);
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(typeof body.minAppVersion, 'string');
    assert.equal(typeof body.currentAppVersion, 'string');
    assert.equal(typeof body.maintenanceMode, 'boolean');
    assert.ok(body.todayJalali);
  });

  await t.test('POST /api/mobile/auth/otp/request rejects invalid phone format', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '12345' }),
    });
    assert.equal(res.status, 400);
    const body: any = await res.json();
    assert.ok(body.error);
  });

  let driverOtpCode = '';
  await t.test('POST /api/mobile/auth/otp/request accepts valid phone and stores code', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/auth/otp/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testDriverPhone }),
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.expiresIn, 120);

    driverOtpCode = body.debugCode;
    if (!driverOtpCode) {
      const rows = await db
        .select()
        .from(otp_codes)
        .where(eq(otp_codes.phone, testDriverPhone))
        .orderBy(desc(otp_codes.createdAt))
        .limit(1);
      assert.ok(rows.length > 0);
      driverOtpCode = rows[0].code;
    }
    assert.equal(driverOtpCode.length, 6);
  });

  await t.test('POST /api/mobile/auth/otp/verify rejects invalid code', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testDriverPhone, code: '000000' }),
    });
    assert.equal(res.status, 400);
    const body: any = await res.json();
    assert.ok(body.error);
  });

  let driverAccessToken = '';
  let driverRefreshToken = '';
  await t.test('POST /api/mobile/auth/otp/verify verifies code and issues driver session', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/auth/otp/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: testDriverPhone, code: driverOtpCode }),
    });
    const body: any = await res.json();
    if (res.status !== 200) {
      console.error('Verify response error:', res.status, body);
    }
    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.ok(body.accessToken);
    assert.ok(body.refreshToken);
    assert.equal(body.user.role, 'DRIVER');
    assert.equal(body.user.driverId, testDriverId);
    driverAccessToken = body.accessToken;
    driverRefreshToken = body.refreshToken;
  });

  await t.test('POST /api/mobile/auth/refresh rotates tokens successfully', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: driverRefreshToken }),
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.accessToken);
    assert.ok(body.refreshToken);
    driverAccessToken = body.accessToken;
  });

  await t.test('GET /api/mobile/driver/loads returns driver load queues', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/driver/loads`, {
      headers: { Authorization: `Bearer ${driverAccessToken}` },
    });
    const body: any = await res.json();
    assert.equal(res.status, 200);
    assert.ok(body.driver);
    assert.equal(body.driver.id, testDriverId);
    assert.ok(Array.isArray(body.activeLoads));
    assert.ok(Array.isArray(body.completedLoads));
  });

  let adminAccessToken = '';
  await t.test('POST /api/mobile/auth/login logs in manager/admin credentials', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'mobile_admin_test', password: testPassword }),
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.accessToken);
    assert.equal(body.user.role, 'ADMIN');
    adminAccessToken = body.accessToken;
  });

  await t.test('GET /api/mobile/manager/kpi returns live operational KPIs', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/manager/kpi`, {
      headers: { Authorization: `Bearer ${adminAccessToken}` },
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.ok(body.todayJalali);
    assert.equal(typeof body.entryTonnageKg, 'number');
    assert.equal(typeof body.exitTonnageKg, 'number');
    assert.ok(Array.isArray(body.inventory));
  });

  await t.test('POST /api/mobile/device-token registers push token', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/device-token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${driverAccessToken}`,
      },
      body: JSON.stringify({ token: 'fcm_test_token_123456789', platform: 'android' }),
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.success, true);
  });

  // ------------------------------------------------------------------------------------------
  // Phase 1 additions: POD contract (canonical path + deprecated alias + idempotency) and the
  // three manager cartable endpoints that used to exist only inside the client's mock engine.
  // ------------------------------------------------------------------------------------------
  const testProductId = `test-prd-${Date.now()}`;
  const testInvoiceId = `test-inv-${Date.now()}`;
  const testOrderId = `test-order-${Date.now()}`;

  await t.test('POST /api/mobile/driver/proof (deprecated alias) stores the receipt with a driver FK', async () => {
    await db.insert(products).values({
      id: testProductId,
      name: 'Test Feed',
      type: 'finished',
      unit: 'kg',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();

    await db.insert(invoices).values({
      id: testInvoiceId,
      type: 'exit',
      date: '1404/01/01',
      productId: testProductId,
      invoiceNumber: 'TEST-0001',
      driverId: testDriverId,
      driverName: 'Test Driver',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();

    const res = await fetch(`${baseUrl}/api/mobile/driver/proof`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${driverAccessToken}`,
      },
      body: JSON.stringify({
        invoice_id: testInvoiceId,
        signature_base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wBHq2v0AAAAAElFTkSuQmCC',
        latitude: 35.7,
        longitude: 51.4,
      }),
    });
    assert.equal(res.status, 201);
    const body: any = await res.json();
    assert.equal(body.success, true);
    // The regression this test locks down: driver_id used to receive the invoice's driver *name*.
    assert.equal(body.proof.driverId, testDriverId);
    assert.ok(body.proof.signatureUrl, 'the base64 signature must be persisted as an upload path');
  });

  await t.test('POST /api/mobile/driver/delivery-receipt twice is idempotent', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/driver/delivery-receipt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${driverAccessToken}`,
      },
      body: JSON.stringify({ invoice_id: testInvoiceId, latitude: 35.7, longitude: 51.4 }),
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.equal(body.alreadyRegistered, true);

    const stored = await db
      .select()
      .from(delivery_proofs)
      .where(eq(delivery_proofs.invoiceId, testInvoiceId));
    assert.equal(stored.length, 1, 'a retry must not create a second delivery receipt');
  });

  await t.test('GET /api/mobile/manager/orders returns the cartable payload for a manager', async () => {
    await db.insert(farmer_orders).values({
      farmerId: testFarmerId,
      productId: testProductId,
      requestedWeight: '5000.00',
      targetDate: '1404/02/01',
      notes: 'Phase 1 cartable test',
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoNothing();

    const res = await fetch(`${baseUrl}/api/mobile/manager/orders`, {
      headers: { Authorization: `Bearer ${adminAccessToken}` },
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.ok(Array.isArray(body.orders));
    assert.ok(body.orders.some((o: any) => o.productName === 'Test Feed'));
  });

  await t.test('GET /api/mobile/manager/orders is forbidden for a driver token', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/manager/orders`, {
      headers: { Authorization: `Bearer ${driverAccessToken}` },
    });
    assert.equal(res.status, 403);
  });

  await t.test('PATCH /api/mobile/manager/orders/:id validates and applies the status', async () => {
    const pending = await db
      .select()
      .from(farmer_orders)
      .where(and(eq(farmer_orders.status, 'pending'), eq(farmer_orders.notes, 'Phase 1 cartable test')))
      .limit(1);
    assert.ok(pending.length > 0);
    const orderId = pending[0].id;

    const badRes = await fetch(`${baseUrl}/api/mobile/manager/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAccessToken}` },
      body: JSON.stringify({ status: 'not-a-status' }),
    });
    assert.equal(badRes.status, 400);

    const okRes = await fetch(`${baseUrl}/api/mobile/manager/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminAccessToken}` },
      body: JSON.stringify({ status: 'approved' }),
    });
    assert.equal(okRes.status, 200);
    const body: any = await okRes.json();
    assert.equal(body.success, true);
    assert.equal(body.order.status, 'approved');
  });

  await t.test('GET /api/mobile/manager/proofs lists the submitted delivery receipt', async () => {
    const res = await fetch(`${baseUrl}/api/mobile/manager/proofs`, {
      headers: { Authorization: `Bearer ${adminAccessToken}` },
    });
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.ok(Array.isArray(body.proofs));
    const mine = body.proofs.find((p: any) => p.invoiceId === testInvoiceId);
    assert.ok(mine, 'the receipt submitted through the alias route must be visible to the manager');
    assert.ok(String(mine.photoBillUrl || mine.signatureUrl).startsWith('http'));
  });

  // ------------------------------------------------------------------------------------------
  // Phase 2 additions: driver trip status (G-8), load-history paging (G-16) and the manager's
  // unmatched-driver report (G-7). Every assertion below drives the real HTTP app against the real
  // database, exactly like the Phase 1 block above.
  // ------------------------------------------------------------------------------------------
  const tripInvoiceId = `test-trip-${Date.now()}`;
  const tripDeliveredId = `test-trip-pod-${Date.now()}`;
  const otherInvoiceId = `test-inv-other-${Date.now()}`;
  const otherDriverId = `test-drv-other-${Date.now()}`;
  const unmatchedDriverId = `test-drv-unmatched-${Date.now()}`;
  const unmatchedInvoiceId = `test-inv-unmatched-${Date.now()}`;
  const unmatchedDriverName = 'راهبر آزمایشی نامطابق';
  // The report groups by `textMatchKey` and DISPLAYS `normalizePersianText(name)` (the same
  // Arabic-letter folding the web app uses for farmers), so «آ» arrives as «ا» and «ي» as «ی».
  const unmatchedDriverDisplayName = normalizePersianText(unmatchedDriverName);

  await db.insert(drivers).values({
    id: otherDriverId,
    name: 'Another Driver',
    phone: '09129990009',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(drivers).values({
    id: unmatchedDriverId,
    name: unmatchedDriverName,
    phone: '09129990008',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(invoices).values({
    id: tripInvoiceId,
    type: 'exit',
    date: '1404/03/01',
    productId: testProductId,
    invoiceNumber: 'TEST-TRIP',
    driverId: testDriverId,
    driverName: 'Test Driver',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(invoices).values({
    id: tripDeliveredId,
    type: 'exit',
    date: '1404/03/02',
    productId: testProductId,
    invoiceNumber: 'TEST-TRIP-POD',
    driverId: testDriverId,
    driverName: 'Test Driver',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(invoices).values({
    id: otherInvoiceId,
    type: 'exit',
    date: '1404/03/03',
    productId: testProductId,
    invoiceNumber: 'TEST-TRIP-OTHER',
    driverId: otherDriverId,
    driverName: 'Another Driver',
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  await db.insert(invoices).values({
    id: unmatchedInvoiceId,
    type: 'exit',
    date: '1404/03/04',
    productId: testProductId,
    invoiceNumber: 'TEST-UNMATCHED',
    // No driver_id on purpose: this is exactly the row shape the manager's unmatched report looks for.
    driverId: null,
    driverName: unmatchedDriverName,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).onConflictDoNothing();

  await t.test('PATCH /api/mobile/driver/loads/:id/trip-status validates its input', async () => {
    const badStatus = await fetch(`${baseUrl}/api/mobile/driver/loads/${tripInvoiceId}/trip-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${driverAccessToken}` },
      body: JSON.stringify({ status: 'flying' }),
    });
    assert.equal(badStatus.status, 400);

    const missing = await fetch(`${baseUrl}/api/mobile/driver/loads/no-such-invoice/trip-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${driverAccessToken}` },
      body: JSON.stringify({ status: 'loading' }),
    });
    assert.equal(missing.status, 404);
  });

  await t.test('PATCH /api/mobile/driver/loads/:id/trip-status is forward-only and idempotent', async () => {
    const patch = async (status: string) =>
      fetch(`${baseUrl}/api/mobile/driver/loads/${tripInvoiceId}/trip-status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${driverAccessToken}` },
        body: JSON.stringify({ status }),
      });

    const loading = await patch('loading');
    assert.equal(loading.status, 200);
    const loadingBody: any = await loading.json();
    assert.equal(loadingBody.tripStatus, 'loading');
    assert.equal(loadingBody.previousStatus, 'assigned');
    assert.equal(loadingBody.unchanged, false);

    // An offline queue replaying the same report must not be an error.
    const replay = await patch('loading');
    assert.equal(replay.status, 200);
    assert.equal((await replay.json() as any).unchanged, true);

    // Going backwards is refused (a stale replay must not rewind the trip).
    const backwards = await patch('at_origin');
    assert.equal(backwards.status, 409);

    // `delivered` is the receipt's job, not a button.
    const delivered = await patch('delivered');
    assert.equal(delivered.status, 409);

    const cancelled = await patch('cancelled');
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json() as any).tripStatus, 'cancelled');

    const afterCancel = await patch('unloading');
    assert.equal(afterCancel.status, 409);
  });

  await t.test("PATCH /api/mobile/driver/loads/:id/trip-status refuses another driver's load", async () => {
    const res = await fetch(`${baseUrl}/api/mobile/driver/loads/${otherInvoiceId}/trip-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${driverAccessToken}` },
      body: JSON.stringify({ status: 'loading' }),
    });
    assert.equal(res.status, 403);
  });

  await t.test('the delivery receipt closes the trip and locks the status', async () => {
    const receipt = await fetch(`${baseUrl}/api/mobile/driver/delivery-receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${driverAccessToken}` },
      body: JSON.stringify({
        invoice_id: tripDeliveredId,
        signature_base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wBHq2v0AAAAAElFTkSuQmCC',
      }),
    });
    assert.equal(receipt.status, 201);

    const stored = await db.select().from(invoices).where(eq(invoices.id, tripDeliveredId)).limit(1);
    assert.equal(stored[0].tripStatus, 'delivered', 'the receipt must stamp the trip as delivered');
    assert.ok(stored[0].tripStatusAt, 'the receipt must record when the trip closed');

    const reopen = await fetch(`${baseUrl}/api/mobile/driver/loads/${tripDeliveredId}/trip-status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${driverAccessToken}` },
      body: JSON.stringify({ status: 'loading' }),
    });
    assert.equal(reopen.status, 409, 'a closed trip must not be reopened');
  });

  await t.test('GET /api/mobile/driver/loads pages the history and reports the trip state', async () => {
    const first = await fetch(`${baseUrl}/api/mobile/driver/loads`, {
      headers: { Authorization: `Bearer ${driverAccessToken}` },
    });
    assert.equal(first.status, 200);
    const firstBody: any = await first.json();
    // Defaults keep the pre-Phase-2 answer (page 1, 100 rows, both lists) so old APKs are unaffected...
    assert.equal(firstBody.page, 1);
    assert.equal(firstBody.limit, 100);
    assert.equal(typeof firstBody.total, 'number');
    assert.equal(typeof firstBody.hasMore, 'boolean');
    assert.ok(Array.isArray(firstBody.activeLoads) && Array.isArray(firstBody.completedLoads));

    // ...while `scope` now pages exactly the list the screen renders (the POD filter runs in SQL).
    const completed = await fetch(`${baseUrl}/api/mobile/driver/loads?scope=completed&limit=2`, {
      headers: { Authorization: `Bearer ${driverAccessToken}` },
    });
    const completedBody: any = await completed.json();
    assert.equal(completedBody.scope, 'completed');
    assert.ok(completedBody.completedLoads.length <= 2);
    assert.ok(completedBody.completedLoads.every((l: any) => l.hasProofOfDelivery === true));
    assert.equal(completedBody.activeLoads.length, 0);

    const active = await fetch(`${baseUrl}/api/mobile/driver/loads?scope=active&limit=2`, {
      headers: { Authorization: `Bearer ${driverAccessToken}` },
    });
    const activeBody: any = await active.json();
    assert.ok(activeBody.activeLoads.every((l: any) => l.hasProofOfDelivery === false));
    assert.equal(activeBody.completedLoads.length, 0);
    assert.ok(activeBody.activeLoads.every((l: any) => typeof l.tripStatus === 'string'));

    // The page size is clamped, so a hostile client cannot ask for the whole table.
    const clamped = await fetch(`${baseUrl}/api/mobile/driver/loads?limit=9999`, {
      headers: { Authorization: `Bearer ${driverAccessToken}` },
    });
    assert.equal((await clamped.json() as any).limit, 200);
  });

  await t.test('GET /api/mobile/manager/unmatched-drivers is manager-only and suggests the right driver', async () => {
    const forbidden = await fetch(`${baseUrl}/api/mobile/manager/unmatched-drivers`, {
      headers: { Authorization: `Bearer ${driverAccessToken}` },
    });
    assert.equal(forbidden.status, 403);

    const res = await fetch(
      `${baseUrl}/api/mobile/manager/unmatched-drivers?type=exit&search=${encodeURIComponent(unmatchedDriverName)}`,
      { headers: { Authorization: `Bearer ${adminAccessToken}` } },
    );
    assert.equal(res.status, 200);
    const body: any = await res.json();
    assert.ok(Array.isArray(body.groups));
    assert.equal(typeof body.totalGroups, 'number');
    assert.equal(typeof body.totalInvoices, 'number');
    assert.equal(body.type, 'exit');

    const mine = body.groups.find((g: any) => g.driverName === unmatchedDriverDisplayName);
    assert.ok(mine, 'the unmapped invoice must appear in the unmatched report');
    assert.ok(mine.count >= 1);
    assert.ok(mine.exitCount >= 1, 'the filter is applied before grouping');
    assert.equal(mine.entryCount, 0);
    // The name is spelled exactly like the driver record, so the report must offer that driver - and
    // only as a suggestion (this endpoint never writes).
    assert.equal(mine.suggestedDriverId, unmatchedDriverId);
    assert.equal(mine.suggestionReason, 'name-exact');
    assert.ok(mine.sampleInvoices.includes('TEST-UNMATCHED'));
    assert.ok(mine.invoiceIds.includes(unmatchedInvoiceId));
  });

  // Cleanup test artifacts
  await db.delete(delivery_proofs).where(eq(delivery_proofs.invoiceId, testInvoiceId)).catch(() => {});
  await db.delete(delivery_proofs).where(eq(delivery_proofs.invoiceId, tripDeliveredId)).catch(() => {});
  for (const invoiceId of [testInvoiceId, tripInvoiceId, tripDeliveredId, otherInvoiceId, unmatchedInvoiceId]) {
    await db.delete(invoices).where(eq(invoices.id, invoiceId)).catch(() => {});
  }
  await db.delete(drivers).where(eq(drivers.id, otherDriverId)).catch(() => {});
  await db.delete(drivers).where(eq(drivers.id, unmatchedDriverId)).catch(() => {});
  await db.delete(farmer_orders).where(eq(farmer_orders.notes, 'Phase 1 cartable test')).catch(() => {});
  await db.delete(invoices).where(eq(invoices.id, testInvoiceId)).catch(() => {});
  await db.delete(products).where(eq(products.id, testProductId)).catch(() => {});
  await db.delete(users).where(eq(users.id, testAdminId)).catch(() => {});
  await db.delete(drivers).where(eq(drivers.id, testDriverId)).catch(() => {});
  await db.delete(farmers).where(eq(farmers.id, testFarmerId)).catch(() => {});

  // Close HTTP test server
  await new Promise<void>((resolve) => server.close(() => resolve()));
  process.exit(0);
});

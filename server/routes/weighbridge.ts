import { Router } from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { farmers, invoices, weighbridge_records } from "../db/schema";
import { requireRole } from "../middleware/auth";
import { actorFromRequest, recordAudit } from "../services/auditService";
import { createInvoiceInTransaction, deleteInvoiceInTransaction } from "../services/invoiceService";
import { addDays, dayDistance, jalaliWindow, plateKey, toGregorian, toJalali } from "../../shared/jalali";
import { toAsciiDigits } from "../../shared/persianText";

/**
 * Weighbridge (باسکول توزین نگار) API.
 *
 * Read endpoints list the tickets imported from the factory SQL Server by the background worker
 * (workers/weighbridge-worker.ts) with date / plate / status filters. Write endpoints assign a
 * ticket to an entry (purchase) or exit (sale) invoice: the net weight is written onto that
 * invoice and the ticket flips to `mapped` inside ONE transaction, with the audit trail.
 *
 * Mounted behind requireAuth + blockViewerWrites in server.ts; mutations additionally require
 * ADMIN/MANAGER.
 */
const router = Router();

export const WEIGHBRIDGE_STATUSES = ["unmapped", "mapped", "archived"] as const;

const asNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const asText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
};

/** Error the shared errorHandler turns into a proper HTTP status. */
const httpError = (status: number, message: string) => {
  const err: any = new Error(message);
  err.status = status;
  err.statusCode = status;
  return err;
};

const parseIntOr = (value: unknown, fallback: number) => {
  const n = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
};

/** Where the bundled worker lives (dist/weighbridge-worker.cjs, next to server.cjs). */
const workerPathFor = (): string =>
  path.resolve(process.env.WEIGHBRIDGE_WORKER || path.join(process.cwd(), "dist", "weighbridge-worker.cjs"));

/**
 * `YYYY/MM/DD` (Jalali) for the ticket's Tehran wall-clock `weigh_time`. Invoices store their date
 * in Jalali, so the remittance created from a ticket must carry a Jalali date matching the weighing
 * time — the raw wall-clock digits are converted directly (never through a JS Date / server TZ).
 */
const jalaliDayOfWeigh = (v: unknown): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ""));
  if (!m) return "";
  const { jy, jm, jd } = toJalali(Number(m[1]), Number(m[2]), Number(m[3]));
  return `${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`;
};

/** The invoice column that carries the scale weight: entry -> scale_weight, exit -> weight. */
export const weightColumnFor = (invoiceType: string): "scaleWeight" | "weight" =>
  String(invoiceType).toLowerCase() === "entry" ? "scaleWeight" : "weight";

/**
 * `invoices.date` is canonically **ISO Gregorian** (`YYYY-MM-DD`) everywhere in this app (the UI
 * renders it as Jalali). This normalises any input to that contract:
 *  - ISO (`2026-10-10`) stays as-is,
 *  - Jalali (`1405/07/18` — e.g. sent by the weighbridge form) is converted,
 *  - otherwise the Gregorian day of the weighing timestamp is used.
 *
 * Regression it fixes: invoices created from a weighing ticket used to be stored with a JALALI
 * date, so the day screens (which match `date === formatToISODate(day)`) never showed them.
 */
const isoInvoiceDate = (value: unknown, fallbackWeighTime: unknown): string => {
  const s = String(value ?? "").trim();
  const m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (y >= 1700) return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const g = toGregorian(y, mo, d);
    return `${g.gy}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
  }
  const w = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fallbackWeighTime ?? ""));
  return w ? `${w[1]}-${w[2]}-${w[3]}` : new Date().toISOString().slice(0, 10);
};

/**
 * «خالص‌شده» (netted) — the ticket's SECOND weighing is done.
 *
 * WHY both weighings (the «خالص‌شده اشتباه» bug): the weighing software writes a ticket at the FIRST
 * weighing and leaves the other weight column at 0 (`وزن پر` filled ⇒ «وزن خالی» = 0 and vice versa).
 * A net computed as `gross - 0` is then just the gross — ticket 3593 stores 26,360 kg as «خالص» while
 * the truck has only been weighed once — so `net_weight > 0` alone counted half-weighed tickets as
 * netted in the list, in the status counters and in every report total.
 *
 * A ticket is netted only when BOTH `gross > 0` AND `tare > 0` AND `net > 0`; everything else is
 * «در انتظار توزین دوم». This single predicate is shared by the list filter, the counters and the
 * report, so the three can never disagree.
 */
const NETTED_SQL = sql`(coalesce(${weighbridge_records.netWeight}, 0) > 0 and coalesce(${weighbridge_records.grossWeight}, 0) > 0 and coalesce(${weighbridge_records.tareWeight}, 0) > 0)`;

/** Server-side twin of it for plain JS rows (list/detail decorations). */
const isNettedRow = (row: any): boolean =>
  Number(row?.net_weight ?? row?.netWeight ?? 0) > 0 &&
  Number(row?.gross_weight ?? row?.grossWeight ?? 0) > 0 &&
  Number(row?.tare_weight ?? row?.tareWeight ?? 0) > 0;

const statusCounts = async () => {
  const rows = await db
    .select({ status: weighbridge_records.status, value: sql<number>`count(*)::int` })
    .from(weighbridge_records)
    .groupBy(weighbridge_records.status);
  const byStatus: Record<string, number> = { unmapped: 0, mapped: 0, archived: 0 };
  for (const r of rows) byStatus[String(r.status)] = Number(r.value) || 0;
  // «خالص‌شده» = BOTH weighings done (see NETTED_SQL); «در انتظار توزین دوم» = still pending.
  const netRows = await db
    .select({
      netted: sql<number>`count(*) FILTER (WHERE ${NETTED_SQL})::int`,
      pending: sql<number>`count(*) FILTER (WHERE not ${NETTED_SQL})::int`,
    })
    .from(weighbridge_records);
  return {
    ...byStatus,
    netted: Number(netRows[0]?.netted) || 0,
    pending: Number(netRows[0]?.pending) || 0,
    total: (byStatus.unmapped || 0) + (byStatus.mapped || 0) + (byStatus.archived || 0),
  };
};

/** Invoice columns surfaced for the «حواله ثبت شد ✓» / مغایرت check. */
const INV_FIELDS = {
  id: invoices.id,
  type: invoices.type,
  date: invoices.date,
  productName: invoices.productName,
  invoiceNumber: invoices.invoiceNumber,
  billNumber: invoices.billNumber,
  scaleWeight: invoices.scaleWeight,
  weight: invoices.weight,
  farmerId: invoices.farmerId,
  sellerName: invoices.sellerName,
};

/**
 * Attach the customer name (نام مشتری) to invoice refs: sales (خروج) carry the farmer/مرغدار via
 * `farmer_id`, purchases (ورود) carry the supplier in `seller_name` — the other one is the fallback,
 * so the weighbridge column can always show who the remittance belongs to.
 */
const withCustomerNames = async (list: any[]): Promise<any[]> => {
  const ids = Array.from(new Set(list.map((i) => asText(i?.farmerId)).filter((v): v is string => !!v)));
  const byId: Record<string, string> = {};
  if (ids.length) {
    const rows = await db.select({ id: farmers.id, name: farmers.name }).from(farmers).where(inArray(farmers.id, ids));
    for (const f of rows) if (f.name) byId[String(f.id)] = String(f.name);
  }
  return list.map((i) => {
    const farmerName = i?.farmerId ? byId[String(i.farmerId)] || null : null;
    const seller = asText(i?.sellerName);
    const customerName = i?.type === "entry" ? seller || farmerName : farmerName || seller;
    return { ...i, farmerName, customerName };
  });
};

/**
 * How many days before/after a weighing a registered remittance is still considered to belong to it
 * (the operator's rule: «بازبینی حواله‌ها نهایت ۳ روز قبل و بعد باسکول»).
 */
const REVIEW_WINDOW_DAYS = 3;

/**
 * Choose the registered remittance that really belongs to a ticket.
 *
 * A bare number match is NOT enough: purchase (ورود) remittances carry the scale's شماره حواله in
 * `bill_number` while sale (خروج) numbering is a different series that can collide with it — so a
 * number can point at an unrelated invoice of the other type (which used to produce a bogus
 * «نوع متفاوت» warning even though the purchase was registered). Candidates are therefore matched
 * by شماره حواله AND by the exact **net weight** (the strong fingerprint), only inside a ±3-day
 * window around the weighing, then scored `number(4) + weight(2) + sameType(8)`.
 */
const pickInvoice = (
  byNumber: any[],
  byWeight: any[],
  direction: string | null,
  weighTime: unknown
): { invoice: any | null; mismatch: boolean; highConfidence: boolean } => {
  const scored: Array<{ inv: any; score: number; dist: number; byNum: boolean; byWt: boolean }> = [];
  const weightIds = new Set(byWeight.map((i: any) => i.id));
  const numberIds = new Set(byNumber.map((i: any) => i.id));
  const push = (inv: any, byNum: boolean, byWt: boolean) => {
    if (!inv) return;
    const dist = dayDistance(weighTime, inv.date);
    // Only remittances dated within ±3 days of the weighing belong to this review.
    if (dist === null || dist > REVIEW_WINDOW_DAYS) return;
    const sameType = !!(direction && inv.type === direction);
    scored.push({ inv, byNum, byWt, dist, score: (byNum ? 4 : 0) + (byWt ? 2 : 0) + (sameType ? 8 : 0) });
  };
  for (const inv of byNumber) push(inv, true, weightIds.has(inv.id));
  for (const inv of byWeight) if (!numberIds.has(inv.id)) push(inv, false, true);
  if (!scored.length) return { invoice: null, mismatch: false, highConfidence: false };
  scored.sort((a, b) => b.score - a.score || a.dist - b.dist);
  const best = scored[0];
  const inv = best.inv;
  // Inside the ±3-day window a number OR weight match is a confident identification of the document
  // the operator filed for this weighing.
  return { invoice: inv, mismatch: !!(direction && inv.type !== direction), highConfidence: best.byNum || best.byWt };
};

/* ------------------------------------------------------------------ listing */

/**
 * Direction of a load from the vendor software's own `InOutFlag` (or `flag`) field.
 *
 * The weighing app writes Persian words — `ورودی` (inbound/purchase) and `خروجی`
 * (outbound/sale) — so we match on the letter level to be robust against spacing/casing.
 * Returns `null` when the field is blank (many tickets leave it empty).
 */
const parseDirection = (payload: any): { direction: 'entry' | 'exit' | null; label: string | null } => {
  const raw = String(payload?.InOutFlag ?? payload?.inOutFlag ?? payload?.flag ?? '').trim();
  if (!raw) return { direction: null, label: null };
  const s = raw.replace(/[یي]/g, 'ی').replace(/[كک]/g, 'ک').replace(/\s+/g, '');
  if (/ورود|وارده|ورودی/.test(s)) return { direction: 'entry', label: raw };
  if (/خروج|خارجه|خارجی|خروجی/.test(s)) return { direction: 'exit', label: raw };
  return { direction: null, label: raw };
};

/** Text fields surfaced from `raw_payload` for display (bill of lading, destination, goods). */
const enrichFromPayload = (row: any) => {
  const p = row?.rawPayload || {};
  // The sync worker already normalised the flag into the `direction` column, so trust that first;
  // rows imported before the column existed fall back to reading the raw payload.
  const stored = String(row?.direction ?? '').trim().toLowerCase();
  const parsed = parseDirection(p);
  const flagDirection = stored === 'entry' || stored === 'exit' ? stored : parsed.direction;
  const net = Number(row?.netWeight ?? row?.net_weight ?? 0);
  // «خالص‌شده» needs BOTH weighings (NETTED_SQL): a net that came from `gross - 0` is not a net at all.
  const netOk = isNettedRow(row);
  // Priority (highest first) — the operator's rules:
  //  1) the invoice actually registered for this ticket (حواله ورود ⇒ ورود, حواله خروج ⇒ خروج);
  //  2) a manual override (direction_locked — the «ویرایش نوع» button), kept across re-syncs;
  //  3) the weighing software's own flag — «ورودی» ⇒ ورود (STAYS entry even when netted);
  //  4) a ticket WITHOUT that flag whose NET weight is known (خالص‌شده) ⇒ خروج;
  //  5) otherwise unknown.
  const invType = row?.invoice?.type === 'exit' ? 'exit' : row?.invoice?.type === 'entry' ? 'entry' : null;
  const locked = row?.directionLocked === true || row?.direction_locked === true;
  let direction: 'entry' | 'exit' | null;
  if (invType) direction = invType;
  else if (locked && (stored === 'entry' || stored === 'exit')) direction = stored;
  else if (flagDirection) direction = flagDirection;
  else if (netOk) direction = 'exit';
  else direction = null;
  const label =
    direction === parsed.direction && parsed.label
      ? parsed.label
      : direction
        ? direction === 'entry'
          ? 'ورود'
          : 'خروج'
        : null;
  // Mismatch check (مغایرت): the weight the linked invoice carries vs this ticket's net weight.
  // Purchases read `scale_weight`, sales read `weight` (falling back to the other column).
  let weightDelta: number | null = null;
  if (row?.invoice && netOk) {
    const rawW = row.invoice.type === 'entry' ? (row.invoice.scaleWeight ?? row.invoice.weight) : (row.invoice.weight ?? row.invoice.scaleWeight);
    const invW = Number(rawW);
    if (rawW !== null && rawW !== undefined && rawW !== '' && Number.isFinite(invW)) {
      weightDelta = Math.round((invW - net) * 1000) / 1000;
    }
  }
  // «حواله ثبت شد ✓» — resolved against the EFFECTIVE direction, so a manual ورود↔خروج edit also
  // switches which registered remittance is looked up (and which weight column is compared).
  const matchesArr: any[] = Array.isArray(row?.existingInvoices) ? row.existingInvoices : [];
  const directMatch = direction ? matchesArr.find((i: any) => i.type === direction) : null;
  const existingInvoice: any = directMatch || matchesArr[0] || null;
  // A registered remittance of the OTHER type is a type mismatch (مغایرت نوع) worth flagging.
  const existingTypeMismatch: boolean = !!(existingInvoice && direction && existingInvoice.type !== direction);
  return {
    ...row,
    direction,
    directionLabel: label,
    directionLocked: locked,
    weightDelta,
    existingInvoice,
    existingTypeMismatch,
    billOfLading: asText(p.BillOfLading ?? p.billOfLading ?? p.BillNumber ?? p.BarNameh) ?? null,
    destination: asText(p.Destination ?? p.destination ?? p.Dest ?? p.Orgin) ?? null,
    goods: asText(p.Goods ?? p.goods ?? row?.goods) ?? null,
    /** نام مشتری as recorded by the weighing software itself. */
    customerName: asText(p.CustomerName ?? p.customerName ?? row?.customerName) ?? null,
    remittanceNumber: asText(p.ShomareHavale ?? p.shomareHavale ?? p.HavaleNo ?? p.remittanceNumber ?? row?.remittanceNumber) ?? null,
  };
};

/**
 * GET /api/weighbridge/records
 * Filters: from, to (ISO dates, inclusive), plate (partial, digits/letters folded), status
 * (unmapped|mapped|archived|all), q (ticket / plate / driver / carrier), limit, offset.
 */
/**
 * The ticket filter shared by the LIST (/records) and the REPORT (/report), so a filter always means
 * the same thing in both. Every date bound is a plain text comparison on the wall-clock
 * `weigh_time` (`YYYY-MM-DD ...`), so the server timezone can never reinterpret factory time.
 */
const buildRecordFilters = (query: any) => {
    const status = String(query.status ?? "all").trim().toLowerCase();

    const where: any[] = [];
    const from = asText(query.from);
    const to = asText(query.to);
    // `weigh_time` is a wall-clock string, so bounds are compared as plain text (`YYYY-MM-DD ...`),
    // avoiding any server-timezone reinterpretation of the factory's local time.
    const dayOf = (v: string): string | null => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    };
    const fromDay = from ? dayOf(from) : null;
    if (fromDay) where.push(gte(weighbridge_records.weighTime, `${fromDay} 00:00:00`));
    const toDay = to ? dayOf(to) : null;
    if (toDay) where.push(lte(weighbridge_records.weighTime, `${toDay} 23:59:59.999`));
    if ((WEIGHBRIDGE_STATUSES as readonly string[]).includes(status)) {
      where.push(eq(weighbridge_records.status, status));
    }
    const plate = asText(query.plate);
    if (plate) {
      const key = plateKey(plate);
      // Fold Persian/Arabic-Indic digits to ASCII in SQL as well: the stored plates are Persian
      // («۱۲ ب ۳۴۵ ایران ۲۲») while users type either form.
      where.push(
        sql`upper(regexp_replace(translate(coalesce(${weighbridge_records.plateNumber}, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'), '[^0-9A-Za-zآ-ی]', '', 'g')) like ${"%" + key + "%"}`
      );
    }
    const q = asText(query.q);
    if (q) {
      const like = `%${q}%`;
      // «جستجوی وزن»: a numeric query ALSO matches the three weight columns, with Persian/Arabic-
      // Indic digits folded to ASCII first, so «۲۵۰۰۰» finds the same tickets as «25000».
      const weightDigits = toAsciiDigits(q).replace(/[^\d.]/g, '');
      const terms: any[] = [
          sql`weighbridge_records.external_id::text ilike ${like}`,
          sql`coalesce(${weighbridge_records.remittanceNumber}, '') ilike ${like}`,
          sql`coalesce(${weighbridge_records.ticketNumber}, '') ilike ${like}`,
          sql`coalesce(${weighbridge_records.plateNumber}, '') ilike ${like}`,
          sql`coalesce(${weighbridge_records.driverName}, '') ilike ${like}`,
          sql`coalesce(${weighbridge_records.customerName}, '') ilike ${like}`
      ];
      if (weightDigits) {
        terms.push(
          sql`coalesce(${weighbridge_records.netWeight}::text, '') like ${"%" + weightDigits + "%"}`,
          sql`coalesce(${weighbridge_records.grossWeight}::text, '') like ${"%" + weightDigits + "%"}`,
          sql`coalesce(${weighbridge_records.tareWeight}::text, '') like ${"%" + weightDigits + "%"}`
        );
      }
      where.push(or(...terms));
    }

    // «خالص‌شده» (BOTH weighings done — NETTED_SQL) vs «در انتظار توزین دوم».
    const net = String(query.net ?? "all").trim().toLowerCase();
    if (net === "done") where.push(NETTED_SQL);
    else if (net === "pending") where.push(sql`not ${NETTED_SQL}`);

    // Extras used by the REPORT (they are harmless for the list, which simply never sends them):
    // direction, goods and a net-weight window — the «جستجوی وزن» of the report filters.
    const direction = asText(query.direction);
    if (direction && ["entry", "exit", "unknown"].includes(direction)) {
      where.push(eq(weighbridge_records.direction, direction));
    }
    const goods = asText(query.goods);
    if (goods) where.push(sql`coalesce(${weighbridge_records.goods}, '') ilike ${"%" + goods + "%"}`);
    const minNet = asNumber(query.minNet);
    if (minNet !== null) where.push(sql`coalesce(${weighbridge_records.netWeight}, 0) >= ${minNet}`);
    const maxNet = asNumber(query.maxNet);
    if (maxNet !== null) where.push(sql`coalesce(${weighbridge_records.netWeight}, 0) <= ${maxNet}`);

    const condition = where.length ? and(...where) : undefined;
  return { condition, where, fromDay, toDay };
};

router.get("/records", async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseIntOr(req.query.limit, 100)));
    const offset = Math.max(0, parseIntOr(req.query.offset, 0));
    const { condition } = buildRecordFilters(req.query);

    const rows = await db
      .select()
      .from(weighbridge_records)
      .where(condition as any)
      .orderBy(desc(weighbridge_records.weighTime), desc(weighbridge_records.id))
      .limit(limit)
      .offset(offset);

    const totalRow = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(weighbridge_records)
      .where(condition as any);

    const counts = await statusCounts();

    const linkedIds = rows.map((r: any) => r.mappedRemittanceId).filter(Boolean) as string[];
    let linked: Record<string, any> = {};
    if (linkedIds.length) {
      const invRows = await db
        .select({
          id: invoices.id,
          type: invoices.type,
          date: invoices.date,
          productName: invoices.productName,
          invoiceNumber: invoices.invoiceNumber,
          billNumber: invoices.billNumber,
          driverName: invoices.driverName,
          scaleWeight: invoices.scaleWeight,
          weight: invoices.weight,
          farmerId: invoices.farmerId,
          sellerName: invoices.sellerName,
        })
        .from(invoices)
        // A soft-deleted invoice must never count as «متصل»: the ticket is shown as unmapped until
        // the reconciliation (worker or delete path) clears the dangling link.
        .where(and(inArray(invoices.id, linkedIds), isNull(invoices.deletedAt)));
      linked = Object.fromEntries((await withCustomerNames(invRows)).map((r: any) => [r.id, r]));
    }

    // «حواله ثبت شد ✓» / مغایرت for UNMAPPED tickets: candidates are matched BOTH by شماره حواله AND
    // by the exact net weight (purchases often keep the scale number in their بارنامه field, and the
    // sale numbering series can collide with it) — `pickInvoice` then scores type + date proximity.
    const unmapped = rows.filter((r: any) => !r.mappedRemittanceId);
    const havaleNumbers: string[] = Array.from(
      new Set<string>(
        unmapped
          .map((r: any) => asText(r.remittanceNumber) || asText(r.rawPayload?.ShomareHavale))
          .filter((v: string | null): v is string => !!v)
      )
    );
    // Only a NETTED ticket (both weighings — isNettedRow) can be fingerprinted by its net weight: a
    // half-weighed ticket's «net» is not a real weight and must never match an invoice.
    const nets: number[] = Array.from(
      new Set<number>(
        unmapped
          .filter((r: any) => isNettedRow(r))
          .map((r: any) => Number(r.netWeight))
          .filter((n: number) => Number.isFinite(n) && n > 0)
      )
    );
    const byHavale: Record<string, any[]> = {};
    const byWeight: Record<string, any[]> = {};
    const byNumberRows: any[] = havaleNumbers.length
      ? await db
          .select(INV_FIELDS)
          .from(invoices)
          .where(or(inArray(invoices.invoiceNumber, havaleNumbers), inArray(invoices.billNumber, havaleNumbers)))
          .limit(500)
      : [];
    const byWeightRows: any[] = nets.length
      ? await db
          .select(INV_FIELDS)
          .from(invoices)
          .where(sql`(coalesce(${invoices.scaleWeight}::numeric, -1) in (${sql.join(nets.map((n) => sql`${n}::numeric`), sql`, `)})) or (coalesce(${invoices.weight}::numeric, -1) in (${sql.join(nets.map((n) => sql`${n}::numeric`), sql`, `)}))`)
          .limit(500)
      : [];
    if (byNumberRows.length || byWeightRows.length) {
      // One batch resolves every customer name (farmer / seller) for the whole page.
      const decorated = await withCustomerNames(
        Array.from(new Map([...byNumberRows, ...byWeightRows].map((i: any) => [i.id, i])).values())
      );
      const byId = new Map(decorated.map((i: any) => [i.id, i]));
      for (const inv of byNumberRows) {
        const inv2 = byId.get(inv.id) || inv;
        for (const key of [asText(inv2.invoiceNumber), asText(inv2.billNumber)]) {
          if (!key) continue;
          (byHavale[key] = byHavale[key] || []).push(inv2);
        }
      }
      for (const inv of byWeightRows) {
        const inv2 = byId.get(inv.id) || inv;
        for (const w of [inv2.scaleWeight, inv2.weight]) {
          const n = Number(w);
          if (Number.isFinite(n) && n > 0) (byWeight[String(n)] = byWeight[String(n)] || []).push(inv2);
        }
      }
    }

    return res.json({
      success: true,
      data: rows.map((r: any) => {
        const enriched = enrichFromPayload({
          ...r,
          invoice: r.mappedRemittanceId ? linked[r.mappedRemittanceId] || null : null,
        });
        if (r.mappedRemittanceId) return enriched;
        const havale = asText(r.remittanceNumber) || asText(r.rawPayload?.ShomareHavale);
        const net = Number(r.netWeight);
        const picked = pickInvoice(
          havale ? byHavale[havale] || [] : [],
          isNettedRow(r) && Number.isFinite(net) && net > 0 ? byWeight[String(net)] || [] : [],
          enriched.direction,
          (r as any).weighTime
        );
        // The operator's own registered remittance is the ground truth: when it is a high-confidence
        // match, the ticket's type follows it (a manual override still wins).
        const alignTo =
          !enriched.directionLocked && picked.highConfidence && picked.invoice && (picked.invoice.type === 'entry' || picked.invoice.type === 'exit')
            ? (picked.invoice.type as 'entry' | 'exit')
            : null;
        return {
          ...enriched,
          direction: alignTo || enriched.direction,
          directionLabel: alignTo ? (alignTo === 'entry' ? 'ورود' : 'خروج') : enriched.directionLabel,
          existingInvoice: picked.invoice,
          existingTypeMismatch: picked.mismatch && !alignTo,
        };
      }),
      total: Number(totalRow[0]?.value) || 0,
      counts,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error("[NIR WEIGHBRIDGE] list failed:", error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || "خطا در دریافت لیست قبوض باسکول" });
  }
});

/** GET /api/weighbridge/stats — counters, last sync time and whether the worker bundle exists. */
router.get("/stats", async (_req, res) => {
  try {
    const counts = await statusCounts();
    const last = await db
      .select({ value: sql<string | null>`max(${weighbridge_records.lastSyncedAt})` })
      .from(weighbridge_records);
    const newest = await db
      .select({ value: sql<string | null>`max(${weighbridge_records.weighTime})` })
      .from(weighbridge_records);
    return res.json({
      success: true,
      data: {
        ...counts,
        lastSyncedAt: last[0]?.value ?? null,
        newestWeighTime: newest[0]?.value ?? null,
        workerBundlePresent: fs.existsSync(workerPathFor()),
        workerBundlePath: workerPathFor(),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || "خطا در دریافت آمار باسکول" });
  }
});

/**
 * GET /api/weighbridge/report — the aggregates behind the «گزارش‌گیری» tab: grand totals, a per-کالا
 * breakdown, the time series (always by DAY; the client buckets it into day/week/month), the
 * entry/exit split, the top customers and the busiest plates.
 *
 * It accepts exactly the same filters as the ticket list (see buildRecordFilters) plus direction /
 * goods / minNet / maxNet, so «جستجوی وزن» and every filter mean the same in both places.
 */
router.get("/report", async (req, res) => {
  try {
    const { condition, fromDay, toDay } = buildRecordFilters(req.query);
    const where = condition as any;
    const topCustomers = Math.min(300, Math.max(1, parseIntOr(req.query.topCustomers, 60)));

    const w = weighbridge_records;
    const toNum = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    // Grouping + aggregate expressions, defined once and reused in select/groupBy so both clauses
    // generate identical SQL.
    const dayKey = sql<string>`left(coalesce(${w.weighTime}::text, ''), 10)`;
    const goodsKey = sql<string>`coalesce(nullif(btrim(${w.goods}), ''), '—')`;
    const customerKey = sql<string>`coalesce(nullif(btrim(${w.customerName}), ''), '—')`;
    const directionKey = sql<string>`coalesce(nullif(btrim(${w.direction}), ''), 'unknown')`;
    const plateKeySql = sql<string>`coalesce(nullif(btrim(${w.plateNumber}), ''), '—')`;
    // Weight aggregates are computed over COMPLETE tickets only — «خالص‌شده» = BOTH weighings done,
    // i.e. exactly NETTED_SQL (the same predicate the list filter uses).
    //
    // WHY (the «گزارش کاربردی نیست» bug): the weighing software stores a ticket as soon as the FIRST
    // weighing happens — for a truck still waiting for its second weighing one weight column is 0 while
    // the other holds the full load (e.g. 26,360 kg). Summing those raw values made a day's «وزن خالص»
    // NEGATIVE (41% of the rows were like that: e.g. 2026-10-11 summed to -21,720 kg), and counting them
    // as netted inflated وزن خالص by a truck-load that never got weighed twice. Incomplete tickets have
    // no net weight at all, so they are counted (tickets/pending) but excluded from gross/tare/net/
    // avg/min/max, and the weight they are holding is reported separately as pendingTare/pendingGross.
    const complete = NETTED_SQL;
    const grossSum = sql<string>`coalesce(sum(${w.grossWeight}) filter (where ${complete}), 0)`;
    const tareSum = sql<string>`coalesce(sum(${w.tareWeight}) filter (where ${complete}), 0)`;
    const netSum = sql<string>`coalesce(sum(${w.netWeight}) filter (where ${complete}), 0)`;
    const avgNet = sql<string>`coalesce(avg(${w.netWeight}) filter (where ${complete}), 0)`;
    const maxNet = sql<string>`coalesce(max(${w.netWeight}) filter (where ${complete}), 0)`;
    const minNet = sql<string>`coalesce(min(${w.netWeight}) filter (where ${complete}), 0)`;
    /** Truck weights that are sitting in tickets still waiting for their second weighing. */
    const pendingTare = sql<string>`coalesce(sum(${w.tareWeight}) filter (where not (${complete})), 0)`;
    const pendingGross = sql<string>`coalesce(sum(${w.grossWeight}) filter (where not (${complete})), 0)`;
    const tickets = sql<number>`count(*)::int`;
    const netted = sql<number>`count(*) filter (where ${complete})::int`;
    const pending = sql<number>`count(*) filter (where not (${complete}))::int`;
    const mapped = sql<number>`count(*) filter (where ${w.status} = 'mapped')::int`;
    const unmapped = sql<number>`count(*) filter (where ${w.status} = 'unmapped')::int`;
    const archived = sql<number>`count(*) filter (where ${w.status} = 'archived')::int`;
    const entryTickets = sql<number>`count(*) filter (where ${w.direction} = 'entry')::int`;
    const exitTickets = sql<number>`count(*) filter (where ${w.direction} = 'exit')::int`;
    const firstDay = sql<string | null>`min(nullif(${dayKey}, ''))`;
    const lastDay = sql<string | null>`max(nullif(${dayKey}, ''))`;

    const [totalsRows, byGoodsRows, byDayRows, byDirectionRows, byCustomerRows, byPlateRows] = await Promise.all([
      db
        .select({
          tickets, gross: grossSum, tare: tareSum, net: netSum, avgNet, maxNet, minNet, computedAt: sql`now()`,
          netted, pending, mapped, unmapped, archived, entryTickets, exitTickets, firstDay, lastDay,
          pendingTare: pendingTare,
          pendingGross: pendingGross,
          plates: sql<number>`count(distinct nullif(btrim(${w.plateNumber}), ''))::int`,
          customers: sql<number>`count(distinct nullif(btrim(${w.customerName}), ''))::int`,
        })
        .from(w)
        .where(where),

      db
        .select({
          goods: goodsKey, tickets, gross: grossSum, tare: tareSum, net: netSum, avgNet, maxNet, minNet,
          netted, pending, mapped, unmapped, archived, firstDay, lastDay,
          pendingTare: pendingTare, pendingGross: pendingGross,
        })
        .from(w)
        .where(where)
        .groupBy(goodsKey)
        .orderBy(desc(netSum)),

      db
        .select({
          day: dayKey, tickets, gross: grossSum, tare: tareSum, net: netSum,
          netted, pending, entryTickets, exitTickets, pendingTare: pendingTare, pendingGross: pendingGross,
        })
        .from(w)
        .where(where)
        .groupBy(dayKey)
        .orderBy(asc(dayKey)),

      db
        .select({ direction: directionKey, tickets, gross: grossSum, tare: tareSum, net: netSum, pending: pending, pendingTare: pendingTare })
        .from(w)
        .where(where)
        .groupBy(directionKey)
        .orderBy(desc(netSum)),

      db
        .select({ customer: customerKey, tickets, gross: grossSum, tare: tareSum, net: netSum, lastDay, pending: pending })
        .from(w)
        .where(where)
        .groupBy(customerKey)
        .orderBy(desc(netSum))
        .limit(topCustomers),

      db
        .select({ plate: plateKeySql, tickets, net: netSum, pending: pending })
        .from(w)
        .where(where)
        .groupBy(plateKeySql)
        .orderBy(desc(netSum))
        .limit(topCustomers),
    ]);

    const t = totalsRows[0] as any;
    return res.json({
      success: true,
      data: {
        range: { from: fromDay, to: toDay },
        totals: {
          tickets: toNum(t?.tickets),
          gross: toNum(t?.gross),
          tare: toNum(t?.tare),
          net: toNum(t?.net),
          avgNet: toNum(t?.avgNet),
          maxNet: toNum(t?.maxNet),
          minNet: toNum(t?.minNet),
          netted: toNum(t?.netted),
          pending: toNum(t?.pending),
          mapped: toNum(t?.mapped),
          unmapped: toNum(t?.unmapped),
          archived: toNum(t?.archived),
          entryTickets: toNum(t?.entryTickets),
          exitTickets: toNum(t?.exitTickets),
          pendingTare: toNum(t?.pendingTare),
          pendingGross: toNum(t?.pendingGross),
          plates: toNum(t?.plates),
          customers: toNum(t?.customers),
          firstDay: t?.firstDay ?? null,
          lastDay: t?.lastDay ?? null,
        },
        byGoods: byGoodsRows.map((r: any) => ({
          goods: r.goods,
          tickets: toNum(r.tickets),
          gross: toNum(r.gross),
          tare: toNum(r.tare),
          net: toNum(r.net),
          avgNet: toNum(r.avgNet),
          maxNet: toNum(r.maxNet),
          minNet: toNum(r.minNet),
          netted: toNum(r.netted),
          pending: toNum(r.pending),
          mapped: toNum(r.mapped),
          unmapped: toNum(r.unmapped),
          archived: toNum(r.archived),
          pendingTare: toNum(r.pendingTare),
          pendingGross: toNum(r.pendingGross),
          firstDay: r.firstDay ?? null,
          lastDay: r.lastDay ?? null,
        })),
        byDay: byDayRows.map((r: any) => ({
          day: r.day,
          tickets: toNum(r.tickets),
          gross: toNum(r.gross),
          tare: toNum(r.tare),
          net: toNum(r.net),
          netted: toNum(r.netted),
          pending: toNum(r.pending),
          entryTickets: toNum(r.entryTickets),
          exitTickets: toNum(r.exitTickets),
          pendingTare: toNum(r.pendingTare),
          pendingGross: toNum(r.pendingGross),
        })),
        byDirection: byDirectionRows.map((r: any) => ({
          direction: r.direction,
          tickets: toNum(r.tickets),
          gross: toNum(r.gross),
          tare: toNum(r.tare),
          net: toNum(r.net),
          pending: toNum(r.pending),
          pendingTare: toNum(r.pendingTare),
        })),
        byCustomer: byCustomerRows.map((r: any) => ({
          customer: r.customer,
          tickets: toNum(r.tickets),
          gross: toNum(r.gross),
          tare: toNum(r.tare),
          net: toNum(r.net),
          pending: toNum(r.pending),
          lastDay: r.lastDay ?? null,
        })),
        byPlate: byPlateRows.map((r: any) => ({
          plate: r.plate,
          tickets: toNum(r.tickets),
          net: toNum(r.net),
          pending: toNum(r.pending),
        })),
      },
    });
  } catch (error: any) {
    console.error("[NIR WEIGHBRIDGE] report failed:", error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || "خطا در تهیه گزارش باسکول" });
  }
});

/**
 * GET /api/weighbridge/report/daily — the «روز × کالا» matrix behind the printable report.
 *
 * One line per (day, کالا) with the same filters as the list, so the operator can hand the accountant a
 * sheet that shows, for each day, how much of EVERY کالا was weighed — plus a «جمع روز» per day and a
 * «جمع کل» — instead of one figure for the whole period. Kept as its own endpoint (the report tab only
 * calls it when the daily detail is opened or printed) so a full-year report never ships thousands of
 * rows to the browser. `net`/`gross`/`tare` cover NETTED tickets only (BOTH weighings — see NETTED_SQL);
 * the weight of the tickets still waiting for their second weighing is reported separately as
 * pendingTare/pendingGross, never mixed into a net total.
 */
/** The «جمع کل» of the daily matrix — the same eight figures the screen and the Excel «جمع کل» row show. */
type DayTotals = { tickets: number; gross: number; tare: number; net: number; netted: number; pending: number; pendingTare: number; pendingGross: number };
router.get("/report/daily", async (req, res) => {
  try {
    const { condition, fromDay, toDay } = buildRecordFilters(req.query);
    const where = condition as any;
    const w = weighbridge_records;
    const toNum = (v: unknown): number => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };

    const dayKey = sql<string>`left(coalesce(${w.weighTime}::text, ''), 10)`;
    const goodsKey = sql<string>`coalesce(nullif(btrim(${w.goods}), ''), '—')`;
    const complete = NETTED_SQL;
    const rows = await db
      .select({
        day: dayKey,
        goods: goodsKey,
        tickets: sql<number>`count(*)::int`,
        gross: sql<string>`coalesce(sum(${w.grossWeight}) filter (where ${complete}), 0)`,
        tare: sql<string>`coalesce(sum(${w.tareWeight}) filter (where ${complete}), 0)`,
        net: sql<string>`coalesce(sum(${w.netWeight}) filter (where ${complete}), 0)`,
        netted: sql<number>`count(*) filter (where ${complete})::int`,
        pending: sql<number>`count(*) filter (where not (${complete}))::int`,
        entryTickets: sql<number>`count(*) filter (where ${w.direction} = 'entry')::int`,
        exitTickets: sql<number>`count(*) filter (where ${w.direction} = 'exit')::int`,
        pendingTare: sql<string>`coalesce(sum(${w.tareWeight}) filter (where not (${complete})), 0)`,
        pendingGross: sql<string>`coalesce(sum(${w.grossWeight}) filter (where not (${complete})), 0)`,
      })
      .from(w)
      .where(where)
      .groupBy(dayKey, goodsKey)
      .orderBy(asc(dayKey), desc(sql`coalesce(sum(${w.netWeight}) filter (where ${complete}), 0)`));

    const totals = rows.reduce(
      (acc: DayTotals, r: any) => {
        acc.tickets += toNum(r.tickets);
        acc.gross += toNum(r.gross);
        acc.tare += toNum(r.tare);
        acc.net += toNum(r.net);
        acc.netted += toNum(r.netted);
        acc.pending += toNum(r.pending);
        acc.pendingTare += toNum(r.pendingTare);
        acc.pendingGross += toNum(r.pendingGross);
        return acc;
      },
      { tickets: 0, gross: 0, tare: 0, net: 0, netted: 0, pending: 0, pendingTare: 0, pendingGross: 0 }
    );

    return res.json({
      success: true,
      data: {
        range: { from: fromDay, to: toDay },
        totals: totals,
        rows: rows.map((r: any) => ({
          day: r.day,
          goods: r.goods,
          tickets: toNum(r.tickets),
          gross: toNum(r.gross),
          tare: toNum(r.tare),
          net: toNum(r.net),
          netted: toNum(r.netted),
          pending: toNum(r.pending),
          entryTickets: toNum(r.entryTickets),
          exitTickets: toNum(r.exitTickets),
          pendingTare: toNum(r.pendingTare),
          pendingGross: toNum(r.pendingGross),
        })),
      },
    });
  } catch (error: any) {
    console.error("[NIR WEIGHBRIDGE] daily report failed:", error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || "خطا در تهیه گزارش روزانه باسکول" });
  }
});

/* ------------------------------------------------------------------ detail */

/** GET /api/weighbridge/records/:id — the ticket plus (when mapped) its invoice. */
router.get("/records/:id", async (req, res) => {
  try {
    const id = parseIntOr(req.params.id, 0);
    if (!id) return res.status(400).json({ success: false, error: "شناسه قبض نامعتبر است" });
    const rec = (await db.select().from(weighbridge_records).where(eq(weighbridge_records.id, id)).limit(1))[0];
    if (!rec) return res.status(404).json({ success: false, error: "قبض باسکول یافت نشد" });

    let invoice: any = null;
    if ((rec as any).mappedRemittanceId) {
      invoice =
        (
          await db
            .select()
            .from(invoices)
            // Soft-deleted invoices are treated as "no link" (the ticket simply shows as unmapped).
            .where(and(eq(invoices.id, (rec as any).mappedRemittanceId), isNull(invoices.deletedAt)))
            .limit(1)
        )[0] || null;
    }
    const enriched = enrichFromPayload({ ...rec, invoice: invoice ? (await withCustomerNames([invoice]))[0] : null });
    if ((rec as any).mappedRemittanceId) return res.json({ success: true, data: enriched });
    // Same «حواله ثبت شد ✓» check the list does: candidates by شماره حواله AND by the exact net
    // weight, then scored by type + date proximity (see pickInvoice).
    const havale = asText((rec as any).remittanceNumber) || asText((rec as any).rawPayload?.ShomareHavale);
    const net = Number((rec as any).netWeight);
    const rawByNumber: any[] = havale
      ? await db.select(INV_FIELDS).from(invoices).where(or(eq(invoices.invoiceNumber, havale), eq(invoices.billNumber, havale))).limit(50)
      : [];
    const rawByWeight: any[] =
      Number.isFinite(net) && net > 0
        ? await db
            .select(INV_FIELDS)
            .from(invoices)
            .where(sql`(coalesce(${invoices.scaleWeight}::numeric, -1) = ${net}::numeric) or (coalesce(${invoices.weight}::numeric, -1) = ${net}::numeric)`)
            .limit(50)
        : [];
    const decorated = await withCustomerNames(Array.from(new Map([...rawByNumber, ...rawByWeight].map((i: any) => [i.id, i])).values()));
    const byId = new Map(decorated.map((i: any) => [i.id, i]));
    const byNumber = rawByNumber.map((i: any) => byId.get(i.id) || i);
    const byWeight = rawByWeight.map((i: any) => byId.get(i.id) || i);
    const picked = pickInvoice(byNumber, byWeight, enriched.direction, (rec as any).weighTime);
    const alignTo =
      !enriched.directionLocked && picked.highConfidence && picked.invoice && (picked.invoice.type === 'entry' || picked.invoice.type === 'exit')
        ? (picked.invoice.type as 'entry' | 'exit')
        : null;
    return res.json({
      success: true,
      data: {
        ...enriched,
        direction: alignTo || enriched.direction,
        directionLabel: alignTo ? (alignTo === 'entry' ? 'ورود' : 'خروج') : enriched.directionLabel,
        existingInvoice: picked.invoice,
        existingTypeMismatch: picked.mismatch && !alignTo,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error?.message || "خطا در دریافت قبض باسکول" });
  }
});

/**
 * GET /api/weighbridge/records/:id/candidates?type=entry|exit&days=5&q=
 * Entry (purchase) or exit (sale) invoices inside a Jalali window around the weigh time,
 * excluding invoices already linked to another ticket. Same-driver rows are flagged.
 */
router.get("/records/:id/candidates", async (req, res) => {
  try {
    const id = parseIntOr(req.params.id, 0);
    if (!id) return res.status(400).json({ success: false, error: "شناسه قبض نامعتبر است" });
    const rec = (await db.select().from(weighbridge_records).where(eq(weighbridge_records.id, id)).limit(1))[0];
    if (!rec) return res.status(404).json({ success: false, error: "قبض باسکول یافت نشد" });

    const type = String(req.query.type ?? "entry").trim().toLowerCase() === "exit" ? "exit" : "entry";
    const days = Math.max(0, Math.min(30, parseIntOr(req.query.days, 3)));
    const { from: jalaliFrom, to: jalaliTo } = jalaliWindow((rec as any).weighTime, days);
    // `invoices.date` is stored as an ISO date (YYYY-MM-DD); older rows may still hold Jalali text,
    // so the window matches either representation.
    const base = (rec as any).weighTime ? new Date((rec as any).weighTime) : new Date();
    const anchor = isNaN(base.getTime()) ? new Date() : base;
    const isoOf = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const isoFrom = isoOf(addDays(anchor, -days));
    const isoTo = isoOf(addDays(anchor, days));

    const takenRows = await db
      .select({ id: weighbridge_records.mappedRemittanceId })
      .from(weighbridge_records)
      .where(and(eq(weighbridge_records.status, "mapped"), sql`${weighbridge_records.mappedRemittanceId} is not null`));
    const taken = takenRows.map((r: any) => r.id).filter(Boolean) as string[];

    const where: any[] = [
      eq(invoices.type, type),
      isNull(invoices.deletedAt),
      or(
        and(gte(invoices.date, jalaliFrom), lte(invoices.date, jalaliTo)),
        and(gte(invoices.date, isoFrom), lte(invoices.date, isoTo))
      ),
    ];
    if (taken.length) {
      where.push(sql`${invoices.id} not in (${sql.join(taken.map((t) => sql`${t}`), sql`, `)})`);
    }
    const q = asText(req.query.q);
    if (q) {
      const like = `%${q}%`;
      where.push(
        or(
          sql`coalesce(${invoices.invoiceNumber}, '') ilike ${like}`,
          sql`coalesce(${invoices.billNumber}, '') ilike ${like}`,
          sql`coalesce(${invoices.driverName}, '') ilike ${like}`,
          sql`coalesce(${invoices.productName}, '') ilike ${like}`,
          sql`coalesce(${invoices.sellerName}, '') ilike ${like}`
        )
      );
    }

    const rows = await db
      .select({
        id: invoices.id,
        type: invoices.type,
        date: invoices.date,
        productName: invoices.productName,
        invoiceNumber: invoices.invoiceNumber,
        billNumber: invoices.billNumber,
        driverName: invoices.driverName,
        driverPhone: invoices.driverPhone,
        sellerName: invoices.sellerName,
        farmerId: invoices.farmerId,
        billWeight: invoices.billWeight,
        scaleWeight: invoices.scaleWeight,
        weight: invoices.weight,
      })
      .from(invoices)
      .where(and(...where))
      .orderBy(desc(invoices.date), asc(invoices.sortOrder), asc(invoices.id))
      .limit(200);

    const recDriver = plateKey((rec as any).driverName);
    const enriched = (await withCustomerNames(rows)).map((r: any) => ({
      ...r,
      driverMatch: recDriver !== "" && plateKey(r.driverName) === recDriver,
      alreadyWeighed: r.scaleWeight !== null || r.weight !== null,
    }));

    return res.json({
      success: true,
      data: enriched,
      window: { from: jalaliFrom, to: jalaliTo, isoFrom, isoTo, days, type },
      record: {
        id: (rec as any).id,
        plateNumber: (rec as any).plateNumber,
        driverName: (rec as any).driverName,
        netWeight: (rec as any).netWeight,
        weighTime: (rec as any).weighTime,
      },
    });
  } catch (error: any) {
    console.error("[NIR WEIGHBRIDGE] candidates failed:", error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || "خطا در دریافت حواله‌های کاندید" });
  }
});

/* -------------------------------------------------------------- mapping */

/**
 * POST /api/weighbridge/records/:id/map  { invoiceId }
 *
 * ONE transaction: link the ticket to an entry/exit invoice, write the net weight onto that
 * invoice (entry -> scale_weight, exit -> weight), fill the driver name when the invoice has
 * none, flip the ticket to `mapped`, and write the audit trail.
 */
router.post("/records/:id/map", requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const id = parseIntOr(req.params.id, 0);
  const invoiceId = asText(req.body?.invoiceId ?? req.body?.mappedRemittanceId ?? req.query.invoiceId);
  if (!id) return res.status(400).json({ success: false, error: "شناسه قبض نامعتبر است" });
  if (!invoiceId) return res.status(400).json({ success: false, error: "انتخاب حواله الزامی است" });

  const actor = actorFromRequest(req);
  try {
    const result = await db.transaction(async (tx: any) => {
      const rec = (
        await tx.select().from(weighbridge_records).where(eq(weighbridge_records.id, id)).limit(1).for("update")
      )[0];
      if (!rec) throw httpError(404, "قبض باسکول یافت نشد");
      if (rec.status === "mapped" && rec.mappedRemittanceId !== invoiceId) {
        throw httpError(409, "این قبض قبلاً به حواله‌ای تخصیص داده شده است");
      }

      const invoice = (await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1).for("update"))[0];
      if (!invoice || invoice.deletedAt) throw httpError(404, "حواله انتخاب‌شده یافت نشد");

      const clash = (
        await tx
          .select({ id: weighbridge_records.id })
          .from(weighbridge_records)
          .where(
            and(
              eq(weighbridge_records.mappedRemittanceId, invoiceId),
              eq(weighbridge_records.status, "mapped"),
              sql`${weighbridge_records.id} <> ${id}`
            )
          )
          .limit(1)
      )[0];
      if (clash) throw httpError(409, "این حواله قبلاً به قبض باسکول دیگری متصل شده است");

      const net = asNumber(rec.netWeight);
      const column = weightColumnFor(String(invoice.type));
      const before = asNumber((invoice as any)[column]);

      const patch: Record<string, any> = {
        updatedAt: new Date(),
        version: sql`${invoices.version} + 1`,
      };
      if (actor.username) patch.updatedBy = actor.username;
      if (net !== null) patch[column] = String(net);
      if (!invoice.driverName || String(invoice.driverName).trim() === "") {
        const dn = asText(rec.driverName);
        if (dn) patch.driverName = dn;
      }

      await tx.update(invoices).set(patch).where(eq(invoices.id, invoiceId));
      await tx
        .update(weighbridge_records)
        .set({
          status: "mapped",
          mappedRemittanceId: invoiceId,
          previousWeightValue: before === null ? null : String(before),
          updatedAt: new Date(),
        })
        .where(eq(weighbridge_records.id, id));

      const label = column === "scaleWeight" ? "وزن باسکول" : "وزن";
      await recordAudit(tx, actor, {
        action: "UPDATE",
        entity: "weighbridge",
        targetIds: [String(id), invoiceId],
        changes: [
          { field: "status", label: "وضعیت قبض", from: rec.status, to: "mapped" },
          { field: column, label, from: before, to: net },
        ],
        context: {
          weighbridgeRecordId: id,
          externalId: rec.externalId,
          invoiceId,
          invoiceType: invoice.type,
          plateNumber: rec.plateNumber,
          driverName: rec.driverName,
          netWeight: net,
        },
        details: `تخصیص قبض باسکول ${rec.externalId} (پلاک ${asText(rec.plateNumber) || '-'}) به حواله ${invoice.type === "entry" ? "ورود" : "خروج"} ${asText(invoice.invoiceNumber) || invoiceId} - ${label}: ${before ?? '-'} ← ${net ?? '-'}`,
      });

      return { recordId: id, invoiceId, invoiceType: invoice.type, column, previousValue: before, netWeight: net };
    });

    return res.json({ success: true, data: result, message: "قبض باسکول به حواله تخصیص داده شد" });
  } catch (error: any) {
    const status = error?.status || error?.statusCode || 500;
    console.error("[NIR WEIGHBRIDGE] map failed:", error?.message || error);
    return res.status(status).json({ success: false, error: error?.message || "خطا در تخصیص قبض باسکول" });
  }
});

/**
 * POST /api/weighbridge/records/:id/unmap
 * Removes the link. The invoice weight is only reverted when it still equals exactly the value
 * this ticket wrote (so a later manual edit is never lost).
 */
router.post("/records/:id/unmap", requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const id = parseIntOr(req.params.id, 0);
  if (!id) return res.status(400).json({ success: false, error: "شناسه قبض نامعتبر است" });
  const actor = actorFromRequest(req);

  try {
    const result = await db.transaction(async (tx: any) => {
      const rec = (
        await tx.select().from(weighbridge_records).where(eq(weighbridge_records.id, id)).limit(1).for("update")
      )[0];
      if (!rec) throw httpError(404, "قبض باسکول یافت نشد");
      if (!rec.mappedRemittanceId) throw httpError(409, "این قبض به هیچ حواله‌ای متصل نیست");

      const invoiceId = String(rec.mappedRemittanceId);
      const invoice = (await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1).for("update"))[0];
      const net = asNumber(rec.netWeight);
      const previous = asText(rec.previousWeightValue);
      const prevNumber = asNumber(rec.previousWeightValue);
      let restored = false;
      // The operator asked for unmapping to remove the whole remittance (the invoice was created
      // from this very ticket), not merely to blank its weight. `deleteInvoice:false` keeps the old
      // behaviour (revert the weight only) for any caller that still needs it.
      const deleteInvoice = (req.body || {}).deleteInvoice !== false;

      // Free the ticket first so nothing references the invoice while it is removed.
      await tx
        .update(weighbridge_records)
        .set({ status: "unmapped", mappedRemittanceId: null, previousWeightValue: null, updatedAt: new Date() })
        .where(eq(weighbridge_records.id, id));

      if (deleteInvoice && invoice) {
        await deleteInvoiceInTransaction(tx, invoiceId, actor);
        restored = true; // (the whole invoice is gone, so the weight question is moot)
      } else if (invoice) {
        const column = weightColumnFor(String(invoice.type));
        const current = asNumber((invoice as any)[column]);
        // Only touch the invoice when the stored value is still exactly what this ticket wrote:
        // a manual edit made afterwards must never be overwritten by an unmap.
        if (net !== null && current !== null && Math.abs(current - net) < 1e-6) {
          const patch: Record<string, any> = { updatedAt: new Date(), version: sql`${invoices.version} + 1` };
          if (actor.username) patch.updatedBy = actor.username;
          patch[column] = previous ?? null; // restore what was there before the ticket wrote
          await tx.update(invoices).set(patch).where(eq(invoices.id, invoiceId));
          restored = true;
        }
      }

      await recordAudit(tx, actor, {
        action: "UPDATE",
        entity: "weighbridge",
        targetIds: [String(id), invoiceId],
        changes: [
          { field: "status", label: "وضعیت قبض", from: rec.status, to: "unmapped" },
          ...(deleteInvoice ? [{ field: "invoice", label: "حواله", from: invoiceId, to: null }] : []),
        ],
        context: { weighbridgeRecordId: id, invoiceId, invoiceDeleted: deleteInvoice, netWeight: net, previousWeight: prevNumber },
        details: deleteInvoice
          ? `لغو تخصیص قبض باسکول ${rec.externalId} و حذف حواله ${asText(invoice?.invoiceNumber) || asText(invoice?.billNumber) || invoiceId}`
          : `لغو تخصیص قبض باسکول ${rec.externalId} از حواله ${invoiceId}${
              restored ? ` (وزن حواله به مقدار قبلی ${prevNumber ?? "خالی"} بازگردانده شد)` : " (وزن حواله دستی تغییر کرده بود و دست‌نخورده ماند)"
            }`,
      });

      return { recordId: id, invoiceId, invoiceDeleted: deleteInvoice, weightReverted: restored && !deleteInvoice, restoredValue: prevNumber };
    });

    return res.json({ success: true, data: result, message: result.invoiceDeleted ? "تخصیص لغو و حواله حذف شد" : "تخصیص قبض لغو شد" });
  } catch (error: any) {
    const status = error?.status || error?.statusCode || 500;
    console.error("[NIR WEIGHBRIDGE] unmap failed:", error?.message || error);
    return res.status(status).json({ success: false, error: error?.message || "خطا در لغو تخصیص قبض" });
  }
});

/**
 * POST /api/weighbridge/sync
 * Runs the bundled worker once, right now, and returns its output (the scheduled task does the
 * same every few minutes). Bounded by a timeout; failures never crash the API.
 */
router.post("/sync", requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const worker = workerPathFor();
  if (!fs.existsSync(worker)) {
    return res.status(503).json({ success: false, error: `فایل ورکر باسکول یافت نشد: ${worker}` });
  }
  try {
    const output = await new Promise<{ code: number | null; log: string; timedOut: boolean }>((resolve) => {
      const child = spawn(process.execPath, [worker, "--once"], {
        cwd: process.cwd(),
        windowsHide: true,
        env: { ...process.env },
      });
      let log = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {
          /* ignore */
        }
      }, 90_000);
      child.stdout?.on("data", (d) => (log += String(d)));
      child.stderr?.on("data", (d) => (log += String(d)));
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({ code: -1, log: `${log}\nspawn error: ${err?.message || err}`, timedOut });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, log, timedOut });
      });
    });

    const actor = actorFromRequest(req);
    try {
      await db.transaction(async (tx: any) => {
        await recordAudit(tx, actor, {
          action: "UPDATE",
          entity: "weighbridge",
          targetIds: [],
          context: { manualSync: true, exitCode: output.code, timedOut: output.timedOut },
          details: `همگام‌سازی دستی باسکول (کد خروج ${output.code ?? "-"}${output.timedOut ? " - مهلت تمام شد" : ""})`,
        });
      });
    } catch (auditError: any) {
      console.error("[NIR WEIGHBRIDGE] manual-sync audit failed:", auditError?.message || auditError);
    }

    return res.json({
      success: output.code === 0,
      data: { exitCode: output.code, timedOut: output.timedOut, log: output.log.slice(-8000) },
    });
  } catch (error: any) {
    console.error("[NIR WEIGHBRIDGE] sync spawn failed:", error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || "خطا در اجرای همگام‌سازی باسکول" });
  }
});

/** `YYYY-MM-DD` from a stored timestamp without shifting timezones (the column is wall-clock). */
const isoDayOf = (value: any): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = value ? new Date(value) : new Date();
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/**
 * PATCH /api/weighbridge/records/:id/direction — manual entry/exit override by the operator.
 * Stored with direction_locked=TRUE so the background sync (which re-derives the direction from
 * the net weight / the scale flag) never overwrites the user's decision.
 */
router.patch("/records/:id/direction", requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const id = parseIntOr(req.params.id, 0);
  if (!id) return res.status(400).json({ success: false, error: "شناسه قبض نامعتبر است" });
  const dir = String((req.body || {}).direction ?? "").trim().toLowerCase();
  if (dir !== "entry" && dir !== "exit") {
    return res.status(400).json({ success: false, error: "نوع باید «ورود» (entry) یا «خروج» (exit) باشد" });
  }
  try {
    const actor = actorFromRequest(req);
    const rec = (await db.select().from(weighbridge_records).where(eq(weighbridge_records.id, id)).limit(1))[0];
    if (!rec) return res.status(404).json({ success: false, error: "قبض باسکول یافت نشد" });
    await db
      .update(weighbridge_records)
      .set({ direction: dir, directionLocked: true, updatedAt: new Date() })
      .where(eq(weighbridge_records.id, id));
    await recordAudit(db, actor, {
      action: "UPDATE",
      entity: "weighbridge",
      targetIds: [String(id)],
      context: { weighbridgeRecordId: id, externalId: rec.externalId, from: (rec as any).direction, to: dir },
      details: `تغییر دستی نوع قبض باسکول ${rec.externalId}: ${(rec as any).direction} ← ${dir === "entry" ? "ورود" : "خروج"}`,
    });
    return res.json({ success: true, data: { id, direction: dir } });
  } catch (error: any) {
    console.error("[NIR WEIGHBRIDGE] set-direction failed:", error?.message || error);
    return res.status(500).json({ success: false, error: error?.message || "خطا در تغییر نوع قبض" });
  }
});

/**
 * POST /api/weighbridge/records/:id/create-remittance
 *
 * Creates the ENTRY (purchase) or EXIT (sale) invoice straight from the weighing ticket and links
 * the two inside ONE transaction. The UI pre-fills every field from the ticket and the operator
 * edits/confirms before this is called.
 *
 * Reuses `createInvoiceInTransaction`, so inventory effects, product provisioning, farmer
 * de-duplication and the invoice audit trail behave exactly like a normal invoice creation.
 */
router.post("/records/:id/create-remittance", requireRole("ADMIN", "MANAGER"), async (req, res) => {
  const id = parseIntOr(req.params.id, 0);
  if (!id) return res.status(400).json({ success: false, error: "شناسه قبض نامعتبر است" });
  const actor = actorFromRequest(req);
  const b = req.body || {};

  try {
    const result = await db.transaction(async (tx: any) => {
      const rec = (
        await tx.select().from(weighbridge_records).where(eq(weighbridge_records.id, id)).limit(1).for("update")
      )[0];
      if (!rec) throw httpError(404, "قبض باسکول یافت نشد");
      if (rec.status === "mapped") throw httpError(409, "این قبض قبلاً به حواله‌ای متصل شده است");

      const bodyType = String(b.type ?? '').trim().toLowerCase();
      // A ticket with a NET weight (fully weighed) defaults to EXIT (خروج) — the operator's rule.
      // The scale's own in/out flag only decides tickets that have no net weight yet.
      const netW = asNumber(rec.netWeight);
      const recDir = netW !== null && netW > 0 ? 'exit' : parseDirection((rec as any).rawPayload).direction;
      const type: "entry" | "exit" =
        bodyType === "exit" || bodyType === "entry"
          ? (bodyType as "entry" | "exit")
          : recDir === "exit"
            ? "exit"
            : "entry";
      const productId = asText(b.productId);
      if (!productId) throw httpError(400, "انتخاب محصول الزامی است");

      const net = asNumber(rec.netWeight);
      const typedWeight = asNumber(b.weight);
      const weight = typedWeight !== null ? typedWeight : net;
      // `invoices.date` is stored ISO (`YYYY-MM-DD`) like the rest of the app (the UI renders it
      // Jalali); Jalali input from the weighbridge form is converted here.
      const date = isoInvoiceDate(asText(b.date), (rec as any).weighTime);
      // شماره حواله comes from the scale's own ShomareHavale on fully-weighed tickets — it is NOT
      // the ticket serial (external_id), and an incomplete ticket has no remittance number yet.
      const scaleHavale =
        net !== null && net > 0
          ? asText((rec as any).remittanceNumber) || asText((rec as any).rawPayload?.ShomareHavale)
          : null;
      // The ticket's identity in audit text is always the weighbridge SERIAL (external_id) —
      // never the remittance number (ShomareHavale) the operator typed into the scale software.
      const ticket = String(rec.externalId);
      const plate = asText(rec.plateNumber);
      // No auto-generated note: only a note the operator explicitly typed is stored on the invoice.

      const payload: any = {
        type,
        date,
        productId,
        productName: asText(b.productName) || undefined,
        driverName: asText(b.driverName) || asText(rec.driverName) || undefined,
        driverPhone: asText(b.driverPhone) || undefined,
        driverIBAN: asText(b.driverIBAN) || undefined,
        notes: asText(b.notes) || undefined,
      };

      if (type === "entry") {
        // Purchases carry the scale weight in `scale_weight` (that is where the app reads it).
        payload.scaleWeight = weight !== null ? weight : undefined;
        payload.billWeight = asNumber(b.billWeight) ?? undefined;
        payload.billNumber = asText(b.billNumber) || scaleHavale || undefined;
        // شماره حواله of the ticket is stamped on the purchase invoice too, so the entry list shows
        // the scale's own number instead of the internal id.
        payload.invoiceNumber = asText(b.invoiceNumber) || scaleHavale || undefined;
        payload.origin = asText(b.origin) || undefined;
        payload.sellerName = asText(b.sellerName) || undefined;
        payload.transportCost = asNumber(b.transportCost) ?? undefined;
        payload.farmerId = asText(b.farmerId) || undefined;
        payload.farmerName = asText(b.farmerName) || undefined;
      } else {
        // Sales carry the weight in `weight` and require a farmer.
        payload.weight = weight !== null ? weight : undefined;
        payload.invoiceNumber = asText(b.invoiceNumber) || scaleHavale || undefined;
        payload.farmerId = asText(b.farmerId) || undefined;
        payload.farmerName = asText(b.farmerName) || undefined;
      }

      const invoiceId = await createInvoiceInTransaction(tx, payload, actor);

      await tx
        .update(weighbridge_records)
        .set({ status: "mapped", mappedRemittanceId: invoiceId, previousWeightValue: null, updatedAt: new Date() })
        .where(eq(weighbridge_records.id, id));

      await recordAudit(tx, actor, {
        action: "CREATE",
        entity: "weighbridge",
        targetIds: [String(id), invoiceId],
        context: {
          weighbridgeRecordId: id,
          externalId: rec.externalId,
          invoiceId,
          invoiceType: type,
          plateNumber: plate,
          netWeight: net,
          weightWritten: weight,
        },
        details: `ایجاد حواله ${type === "entry" ? "ورود" : "خروج"} از قبض باسکول ${ticket}${plate ? ` (پلاک ${plate})` : ""} و اتصال آن — وزن: ${weight ?? "-"}`,
      });

      // Return the created row so the client can mirror it into its local cache immediately
      // (otherwise the day screens would only show it after a full reload/hydration).
      const created = (await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1))[0] || null;
      return { recordId: id, invoiceId, invoiceType: type, weightWritten: weight, date, invoice: created };
    });

    return res.json({ success: true, data: result, message: "حواله ایجاد و قبض باسکول به آن متصل شد" });
  } catch (error: any) {
    const status = error?.status || error?.statusCode || 500;
    console.error("[NIR WEIGHBRIDGE] create-remittance failed:", error?.message || error);
    return res
      .status(status)
      .json({ success: false, error: error?.message || "خطا در ایجاد حواله از قبض باسکول" });
  }
});

export default router;





import React, { useMemo, useState } from 'react';
import Swal from 'sweetalert2';
import { Exit, Farmer } from '../types';
import * as dataService from '../services/dataService';
import { toPersianNumerals, formatDate } from '../utils/formatters';
import { farmerNameKey } from '../shared/persianText';

interface FarmerDataRepairPanelProps {
    farmers: Farmer[];
    allExits: Exit[];
    onChanged: () => void;
}

interface OrphanGroup { farmerId: string; invoiceIds: string[]; weight: number; lastDate: string; }

/**
 * «بهبود دادهها» — reconciliation for the damage the old merge/duplicate bugs left behind.
 *
 * Two independent problems are surfaced here, both fixable in one click:
 *   1. DUPLICATE FARMERS: rows whose names differ only by Arabic/Persian letters, ZWNJ or spacing
 *      (which is why Period Management showed the same farmer twice). Merging them runs the strict
 *      server-side transaction that re-points every invoice.
 *   2. ORPHAN EXIT INVOICES: rows whose farmer row no longer resolves, i.e. the ones the UI could
 *      only display as «ناشناس». They can be attached to the right farmer (server transaction).
 */
const FarmerDataRepairPanel: React.FC<FarmerDataRepairPanelProps> = ({ farmers, allExits, onChanged }) => {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [targets, setTargets] = useState<Record<string, string>>({});

    const activeFarmers = useMemo(() => farmers.filter(f => !(f as any).isDeleted), [farmers]);

    // (1) duplicate groups by normalised name
    const duplicateGroups = useMemo(() => {
        const groups = new Map<string, Farmer[]>();
        for (const farmer of activeFarmers) {
            const key = farmerNameKey(farmer.name);
            if (!key) continue;
            const bucket = groups.get(key) || [];
            bucket.push(farmer);
            groups.set(key, bucket);
        }
        return Array.from(groups.values()).filter(list => list.length > 1);
    }, [activeFarmers]);

    // (2) exit invoices whose farmerId is no longer resolvable
    const orphans = useMemo<OrphanGroup[]>(() => {
        const known = new Set(activeFarmers.map(f => f.id));
        const groups = new Map<string, OrphanGroup>();
        for (const exit of allExits) {
            const farmerId = (exit as any).farmerId;
            if (!farmerId || known.has(farmerId)) continue;
            const group: OrphanGroup = groups.get(farmerId) ?? { farmerId, invoiceIds: [], weight: 0, lastDate: '' };
            group.invoiceIds.push(exit.id);
            group.weight += Number(exit.weight || 0);
            if (exit.date && exit.date > group.lastDate) group.lastDate = exit.date;
            groups.set(farmerId, group);
        }
        return Array.from(groups.values()).sort((a, b) => b.invoiceIds.length - a.invoiceIds.length);
    }, [activeFarmers, allExits]);

    const invoiceCount = (farmerId: string) => allExits.filter(e => (e as any).farmerId === farmerId).length;

    const issueCount = duplicateGroups.length + orphans.length;
    if (issueCount === 0) return null;


    const mergeInto = async (source: Farmer, target: Farmer) => {
        const sourceInvoices = invoiceCount(source.id);
        const confirm = await Swal.fire({
            title: 'ادغام دو رکورد تکراری',
            html: `<div style="text-align:right;font-size:13px">
                <p>ادغام <strong style="color:#b91c1c">«${source.name}»</strong> (${toPersianNumerals(sourceInvoices)} حواله) در <strong style="color:#047857">«${target.name}»</strong></p>
                <p style="margin-top:8px">تمام حواله‌ها و دوره‌های جوجه‌ریزی هر دو رکورد روی «${target.name}» جمع می‌شوند. این عملیات در یک تراکنش دیتابیس انجام می‌شود و رکورد مبدأ فقط بایگانی می‌شود (حذف فیزیکی نمی‌شود).</p>
            </div>`,
            icon: 'warning',
            showCancelButton: true,
            confirmButtonColor: '#dc2626',
            confirmButtonText: 'بله، ادغام کن',
            cancelButtonText: 'لغو',
        });
        if (!confirm.isConfirmed) return;

        setBusy(true);
        try {
            const result = await dataService.mergeFarmers(source.id, target.id);
            await Swal.fire({
                title: 'ادغام انجام شد',
                html: `<div style="font-size:13px;text-align:right">${toPersianNumerals(result.invoiceCount)} حواله به «${target.name}» منتقل شد.</div>`,
                icon: 'success',
                timer: 2200,
                showConfirmButton: false,
            });
            onChanged();
        } catch (e: any) {
            Swal.fire({ title: 'ادغام ناموفق', text: e?.message || 'خطای نامشخص', icon: 'error' });
        } finally {
            setBusy(false);
        }
    };

    const adopt = async (group: OrphanGroup) => {
        const targetId = targets[group.farmerId];
        if (!targetId) {
            Swal.fire({ title: 'مرغدار مقصد را انتخاب کنید', icon: 'warning', timer: 1600, showConfirmButton: false });
            return;
        }
        const targetName = activeFarmers.find(f => f.id === targetId)?.name || '';
        setBusy(true);
        try {
            const moved = await dataService.reassignInvoicesToFarmer(targetId, group.invoiceIds);
            Swal.fire({
                title: 'انتساب انجام شد',
                html: `<div style="font-size:13px;text-align:right">${toPersianNumerals(moved)} حواله به «${targetName}» منتقل شد.</div>`,
                icon: 'success',
                timer: 2200,
                showConfirmButton: false,
            });
            onChanged();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 mb-2 no-print">
            <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 text-right">
                <span className="flex items-center gap-2">
                    <span className={`text-amber-600 transition-transform ${open ? 'rotate-90' : ''}`}>▾</span>
                    <span className="font-bold text-amber-900 text-sm">بهبود داده‌ها (مرغداران تکراری و حواله‌های بدون مرغدار)</span>
                </span>
                <span className="bg-amber-200 text-amber-900 text-xs font-bold rounded-full px-2 py-0.5">{toPersianNumerals(issueCount)} مورد</span>
            </button>

            {open && (
                <div className="mt-3 space-y-3 text-xs">
                    {duplicateGroups.length > 0 && (
                        <div className="bg-white rounded-lg p-3 border border-amber-200">
                            <h3 className="font-bold text-slate-700 mb-2">مرغداران تکراری ({toPersianNumerals(duplicateGroups.length)} گروه)</h3>
                            <ul className="space-y-2">
                                {duplicateGroups.map((group, index) => {
                                    // The row with more history becomes the target; the other is merged in.
                                    const sorted = [...group].sort((a, b) => invoiceCount(b.id) - invoiceCount(a.id));
                                    const target = sorted[0];
                                    const source = sorted[1];
                                    return (
                                        <li key={index} className="flex flex-wrap items-center gap-2 bg-amber-50/60 rounded-lg p-2">
                                            <span className="font-semibold text-slate-700">{group.map(f => f.name).join('  /  ')}</span>
                                            <span className="text-slate-500">
                                                (حواله‌ها: {group.map(f => toPersianNumerals(invoiceCount(f.id))).join(' / ')})
                                            </span>
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => mergeInto(source, target)}
                                                className="mr-auto bg-amber-600 text-white px-3 py-1 rounded-lg font-bold hover:bg-amber-700 disabled:opacity-50"
                                            >
                                                ادغام در «{target.name}»
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}



                    {orphans.length > 0 && (
                        <div className="bg-white rounded-lg p-3 border border-red-200">
                            <h3 className="font-bold text-slate-700 mb-1">حواله‌های بدون مرغدار (نمایش «ناشناس») — {toPersianNumerals(orphans.length)} گروه</h3>
                            <p className="text-slate-500 mb-2">این حواله‌ها به مرغداری اشاره می‌کنند که دیگر در لیست نیست؛ با انتخاب مرغدار مقصد، سوابق به او منتقل می‌شود.</p>
                            <ul className="space-y-2">
                                {orphans.map(group => (
                                    <li key={group.farmerId} className="flex flex-wrap items-center gap-2 bg-red-50/60 rounded-lg p-2">
                                        <span className="font-mono text-[10px] text-slate-500" dir="ltr">{group.farmerId}</span>
                                        <span className="text-slate-600">
                                            {toPersianNumerals(group.invoiceIds.length)} حواله · {toPersianNumerals(Math.round(group.weight).toLocaleString())} kg
                                            {group.lastDate ? ' · آخرین: ' + formatDate(group.lastDate) : ''}
                                        </span>
                                        <select
                                            value={targets[group.farmerId] || ''}
                                            onChange={e => setTargets(prev => ({ ...prev, [group.farmerId]: e.target.value }))}
                                            className="mr-auto p-1.5 border rounded-lg text-xs bg-white"
                                        >
                                            <option value="">انتقال به مرغدار...</option>
                                            {activeFarmers.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                                        </select>
                                        <button
                                            type="button"
                                            disabled={busy || !targets[group.farmerId]}
                                            onClick={() => adopt(group)}
                                            className="bg-sky-600 text-white px-3 py-1 rounded-lg font-bold hover:bg-sky-700 disabled:opacity-50"
                                        >
                                            انتقال
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default FarmerDataRepairPanel;

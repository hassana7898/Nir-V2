import React, { useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import {
  FailedMutation,
  getFailedMutationList,
  getPendingMutations,
  requeueFailedMutation,
  discardFailedMutation,
  clearFailedMutations,
} from '../services/dbStore';
import { triggerSync } from '../services/dataService';
import { toPersianNumerals } from '../utils/formatters';

const ACTION_LABEL: Record<string, string> = { create: 'ایجاد', update: 'ویرایش', delete: 'حذف' };

/**
 * Sync health indicator.
 *
 * Shows retryable mutations (still in `syncQueue`) and permanently failed mutations
 * (dead-lettered into `failedMutations`). Dead letters are actionable: retry or discard -
 * they never block the rest of the sync.
 */
const SyncStatusIndicator: React.FC = () => {
  const [pendingCount, setPendingCount] = useState(0);
  const [failed, setFailed] = useState<FailedMutation[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([getPendingMutations(), getFailedMutationList()]);
      setPendingCount(p.length);
      setFailed(f);
    } catch {
      /* IndexedDB unavailable - nothing to show */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onChange = () => void refresh();
    window.addEventListener('sync_queue_updated', onChange);
    window.addEventListener('failed_mutations_updated', onChange);
    const interval = window.setInterval(refresh, 15000);
    return () => {
      window.removeEventListener('sync_queue_updated', onChange);
      window.removeEventListener('failed_mutations_updated', onChange);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const openPanel = async () => {
    const rows = (await getFailedMutationList())
      .map((m) => `<li style="margin:4px 0">
            <code style="font-size:11px;background:#f1f5f9;padding:2px 4px;border-radius:4px">${m.entityType} · ${ACTION_LABEL[m.action] || m.action}</code>
            <span style="color:#b91c1c;font-size:12px"> ${(m.lastError || m.failureCode || 'خطای نامشخص').slice(0, 120)}</span>
          </li>`)
      .join('');

    const result = await Swal.fire({
      title: 'عملیات ناموفق (صف خطا)',
      html: rows
        ? `<div style="text-align:right;font-size:13px">این عملیات‌ها پس از تلاش‌های مکرر در صف خطا قرار گرفتند و بقیه‌ی همگام‌سازی را متوقف نمی‌کنند:<ul style="padding-inline-start:18px;margin:8px 0">${rows}</ul></div>`
        : '<div style="font-size:13px">صف خطا خالی است.</div>',
      icon: rows ? 'warning' : 'success',
      showDenyButton: !!rows,
      denyButtonText: 'تلاش مجدد همه',
      showCancelButton: !!rows,
      cancelButtonText: 'پاک کردن صف خطا',
      confirmButtonText: 'بستن',
      confirmButtonColor: '#0284c7',
      denyButtonColor: '#059669',
      cancelButtonColor: '#64748b',
    });

    if (result.isDenied) {
      setBusy(true);
      const list = await getFailedMutationList();
      for (const m of list) await requeueFailedMutation(m.id);
      await triggerSync();
      await refresh();
      setBusy(false);
      Swal.fire({ title: 'تلاش مجدد انجام شد', icon: 'success', timer: 1500, showConfirmButton: false });
    } else if (result.isDismissed && result.dismiss === Swal.DismissReason.cancel) {
      await clearFailedMutations();
      await refresh();
      Swal.fire({ title: 'صف خطا پاک شد', icon: 'success', timer: 1500, showConfirmButton: false });
    }
  };

  const discard = async (id: string) => {
    await discardFailedMutation(id);
    await refresh();
  };

  if (failed.length === 0 && pendingCount === 0) return null;

  const hasFailed = failed.length > 0;
  return (
    <button
      type="button"
      onClick={openPanel}
      title={hasFailed ? 'عملیات ناموفق - برای مشاهده کلیک کنید' : 'در حال همگام‌سازی'}
      disabled={busy}
      className={`fixed bottom-4 left-4 z-40 flex items-center gap-2 rounded-full px-3 py-2 text-xs shadow-lg transition-colors ${
        hasFailed ? 'bg-red-100 text-red-800 hover:bg-red-200' : 'bg-sky-100 text-sky-800 hover:bg-sky-200'
      }`}
    >
      <span className={`inline-block h-2 w-2 rounded-full ${hasFailed ? 'bg-red-500' : 'animate-pulse bg-sky-500'}`} />
      {hasFailed
        ? `صف خطا: ${toPersianNumerals(failed.length)}`
        : `در حال همگام‌سازی: ${toPersianNumerals(pendingCount)}`}
    </button>
  );
};

export default SyncStatusIndicator;

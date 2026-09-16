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
import { triggerSync, getSyncState } from '../services/dataService';
import { toPersianNumerals } from '../utils/formatters';

const ACTION_LABEL: Record<string, string> = { create: 'ایجاد', update: 'ویرایش', delete: 'حذف' };

type ConnectionStatus = 'offline' | 'failed' | 'syncing' | 'pending' | 'online';

/**
 * Global sync / connectivity indicator.
 *
 * Shows, in priority order:
 *   - offline  : no network (grey/amber, small dot)
 *   - failed   : permanently failed mutations (red) - clickable dead-letter review panel
 *   - syncing  : an in-flight sync (sky, pulsing)
 *   - pending  : retryable mutations waiting in the outbox (sky, pulsing)
 *   - online   : everything healthy (green, small dot)
 *
 * The failed-mutation panel is actionable: retry or discard - dead letters never block
 * the rest of the sync.
 */
const SyncStatusIndicator: React.FC = () => {
  const [pendingCount, setPendingCount] = useState(0);
  const [failed, setFailed] = useState<FailedMutation[]>([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [syncing, setSyncing] = useState<boolean>(() => getSyncState().syncing);

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

  // Keep connectivity fresh even when the OS/browser toggles the network mid-session.
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Mirror the sync lifecycle published by services/dataService.
  useEffect(() => {
    const onSyncState = () => setSyncing(getSyncState().syncing);
    onSyncState();
    window.addEventListener('sync_state_changed', onSyncState);
    return () => window.removeEventListener('sync_state_changed', onSyncState);
  }, []);

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

  const hasFailed = failed.length > 0;

  const status: ConnectionStatus = !online
    ? 'offline'
    : hasFailed
      ? 'failed'
      : syncing
        ? 'syncing'
        : pendingCount > 0
          ? 'pending'
          : 'online';

  const pillClass =
    status === 'offline'
      ? 'bg-slate-200 text-slate-700 hover:bg-slate-300'
      : status === 'failed'
        ? 'bg-red-100 text-red-800 hover:bg-red-200'
        : status === 'online'
          ? 'bg-green-100 text-green-800 hover:bg-green-200'
          : 'bg-sky-100 text-sky-800 hover:bg-sky-200';

  const dotClass =
    status === 'offline'
      ? 'bg-amber-500'
      : status === 'failed'
        ? 'bg-red-500'
        : status === 'online'
          ? 'bg-green-500'
          : 'animate-pulse bg-sky-500';

  const label =
    status === 'offline'
      ? 'آفلاین'
      : status === 'failed'
        ? `صف خطا: ${toPersianNumerals(failed.length)}`
        : status === 'syncing'
          ? 'در حال همگام‌سازی…'
          : status === 'pending'
            ? `در انتظار همگام‌سازی: ${toPersianNumerals(pendingCount)}`
            : 'آنلاین';

  const title =
    status === 'offline'
      ? 'آفلاین - اتصال اینترنت برقرار نیست'
      : status === 'failed'
        ? 'عملیات ناموفق - برای مشاهده کلیک کنید'
        : status === 'syncing'
          ? 'در حال همگام‌سازی'
          : status === 'pending'
            ? 'در انتظار همگام‌سازی'
            : 'آنلاین';

  return (
    <button
      type="button"
      onClick={openPanel}
      title={title}
      disabled={busy}
      className={`no-print fixed bottom-4 left-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 whitespace-nowrap rounded-full px-3 py-2 text-xs shadow-lg transition-colors ${pillClass}`}
    >
      <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
      {label}
    </button>
  );
};

export default SyncStatusIndicator;

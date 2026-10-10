import React, { useCallback, useEffect, useState } from 'react';
import Swal from 'sweetalert2';
import {
  FailedMutation,
  SyncMutation,
  getFailedMutationList,
  getPendingMutations,
  requeueFailedMutation,
  discardFailedMutation,
  clearFailedMutations,
  clearSyncQueue,
  removeMutation,
} from '../services/dbStore';
import { triggerSync, getSyncState } from '../services/dataService';
import { toPersianNumerals } from '../utils/formatters';
import { showToast } from '../utils/helpers';

const ACTION_LABEL: Record<string, string> = { create: 'ایجاد', update: 'ویرایش', delete: 'حذف' };

type ConnectionStatus = 'offline' | 'failed' | 'syncing' | 'pending' | 'online';

/** Auto-drain cadence while the outbox is non-empty (ms). */
const AUTO_DRAIN_INTERVAL = 60000;

const itemError = (m: { lastError?: string; failureCode?: string }): string =>
  (m.lastError || m.failureCode || 'خطای نامشخص').slice(0, 140);

const smallButtonStyle =
  'background:#fee2e2;color:#b91c1c;border:0;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer;white-space:nowrap';

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
 * The panel is state-accurate: a failure state NEVER renders a success checkmark, and both
 * queues are actionable - "همگام‌سازی فوری" drains the outbox, "پاک‌سازی صف" purges it, and
 * single items can be dropped inline. The outbox is also drained automatically (on mount, when
 * the browser comes back online and every minute while it is non-empty) so a queue can never
 * sit stuck forever just because nobody opened this panel.
 */
const SyncStatusIndicator: React.FC = () => {
  const [pending, setPending] = useState<SyncMutation[]>([]);
  const [failed, setFailed] = useState<FailedMutation[]>([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [syncing, setSyncing] = useState<boolean>(() => getSyncState().syncing);

  const pendingCount = pending.length;

  const refresh = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([getPendingMutations(), getFailedMutationList()]);
      setPending(p as SyncMutation[]);
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

  /**
   * Auto-drain the outbox. This is the fix for the "33 items pending forever" outage: the queue
   * used to be drained only by a button that was hidden whenever no dead letters existed.
   */
  useEffect(() => {
    let cancelled = false;
    const drain = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      let queued: SyncMutation[] = [];
      try {
        queued = (await getPendingMutations()) as SyncMutation[];
      } catch {
        return;
      }
      if (cancelled || queued.length === 0) return;
      try {
        await triggerSync();
      } catch (e) {
        // A failed drain must never produce an unhandled rejection; the queue just stays put.
        console.warn('[NIR] auto-sync failed:', e);
      }
      if (!cancelled) await refresh();
    };
    void drain();
    const timer = window.setInterval(() => { void drain(); }, AUTO_DRAIN_INTERVAL);
    window.addEventListener('online', drain);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('online', drain);
    };
  }, [refresh]);

  const openPanel = async () => {
    const [pendingRows, failedRows] = await Promise.all([getPendingMutations(), getFailedMutationList()]);
    setPending(pendingRows as SyncMutation[]);
    setFailed(failedRows);

    const hasPending = pendingRows.length > 0;
    const hasFailed = failedRows.length > 0;

    // Each queue is listed with its own real error text: the old panel showed a success
    // checkmark plus "صف خطا خالی است" even when 33 mutations were still waiting.
    const failedHtml = failedRows
      .map((m) => `<li style="margin:6px 0;display:flex;gap:6px;align-items:flex-start;justify-content:space-between">
            <span>
              <code style="font-size:11px;background:#f1f5f9;padding:2px 4px;border-radius:4px">${m.entityType} · ${ACTION_LABEL[m.action] || m.action}</code>
              <span style="color:#b91c1c;font-size:12px"> ${itemError(m)}</span>
              <span style="display:block;color:#64748b;font-size:11px">تلاش‌ها: ${toPersianNumerals(m.retryCount || 0)}${m.failureCode ? ' · کد: ' + m.failureCode : ''}</span>
            </span>
            <button type="button" data-discard-id="${m.id}" style="${smallButtonStyle}">حذف</button>
          </li>`)
      .join('');

    const pendingHtml = pendingRows
      .map((m) => `<li style="margin:6px 0;display:flex;gap:6px;align-items:flex-start;justify-content:space-between">
            <span>
              <code style="font-size:11px;background:#f1f5f9;padding:2px 4px;border-radius:4px">${m.entityType} · ${ACTION_LABEL[m.action] || m.action}</code>
              <span style="color:#b45309;font-size:12px"> ${itemError(m)}</span>
              <span style="display:block;color:#64748b;font-size:11px">تلاش‌ها: ${toPersianNumerals(m.retryCount || 0)}</span>
            </span>
            <button type="button" data-pending-id="${m.id}" style="${smallButtonStyle}">حذف</button>
          </li>`)
      .join('');

    const body = hasFailed
      ? `<div style="text-align:right;font-size:13px">این عملیات‌ها پس از تلاش‌های مکرر رد شدند و به «صف خطا» منتقل شده‌اند؛ بقیه‌ی همگام‌سازی را متوقف نمی‌کنند:
           <ul style="padding-inline-start:18px;margin:8px 0">${failedHtml}</ul></div>`
      : hasPending
        ? `<div style="text-align:right;font-size:13px">
             ${toPersianNumerals(pendingRows.length)} تغییر هنوز روی سرور اعمال نشده است. با «همگام‌سازی فوری» دوباره ارسال می‌شود:
             <ul style="padding-inline-start:18px;margin:8px 0">${pendingHtml}</ul></div>`
        : '<div style="text-align:right;font-size:13px">همه‌ی تغییرات با سرور همگام است.</div>';

    const result = await Swal.fire({
      title: hasFailed ? 'عملیات ناموفق (صف خطا)' : hasPending ? 'در انتظار همگام‌سازی' : 'همگام‌سازی سالم',
      html: body,
      // A failure/pending state must NEVER render a green success checkmark.
      icon: hasFailed ? 'error' : hasPending ? 'warning' : 'success',
      showDenyButton: hasFailed || hasPending,
      denyButtonText: hasFailed ? 'تلاش مجدد همه' : 'همگام‌سازی فوری',
      denyButtonColor: '#059669',
      showCancelButton: hasFailed || hasPending,
      cancelButtonText: hasFailed ? 'پاک کردن صف خطا' : 'پاک‌سازی صف',
      cancelButtonColor: '#dc2626',
      confirmButtonText: 'بستن',
      confirmButtonColor: '#0284c7',
      didOpen: (popup) => {
        // Per-item removal: give up on ONE stubborn mutation without touching the rest.
        popup.querySelectorAll<HTMLButtonElement>('button[data-discard-id]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-discard-id');
            if (!id) return;
            await discard(id);
            Swal.close();
            showToast('مورد ناموفق حذف شد.', 'info');
          });
        });
        popup.querySelectorAll<HTMLButtonElement>('button[data-pending-id]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-pending-id');
            if (!id) return;
            await removeMutation(id);
            Swal.close();
            showToast('مورد از صف همگام‌سازی حذف شد.', 'info');
          });
        });
      },
    });

    if (result.isDenied) {
      // "تلاش مجدد همه" / "همگام‌سازی فوری" - the drain is now ALWAYS reachable, even with an
      // empty dead-letter store (that is what used to leave 33 items stuck forever).
      if (hasFailed) await retryAllFailed();
      else await syncNow();
    } else if (result.isDismissed && result.dismiss === Swal.DismissReason.cancel) {
      await purge(hasFailed ? 'failed' : 'pending');
    }
  };

  /** Drop a single dead letter. */
  const discard = async (id: string) => {
    await discardFailedMutation(id);
    await refresh();
  };

  /** Drain whatever is queued right now and report the REAL outcome (icon included). */
  const syncNow = async (): Promise<{ pending: number; failed: number }> => {
    setBusy(true);
    const ok = await triggerSync();
    const [p, f] = await Promise.all([getPendingMutations(), getFailedMutationList()]);
    setPending(p as SyncMutation[]);
    setFailed(f);
    setBusy(false);

    if (ok && p.length === 0 && f.length === 0) {
      showToast('همگام‌سازی با موفقیت انجام شد.', 'success');
    } else if (f.length > 0) {
      // A real failure must NEVER be reported with a green checkmark.
      showToast(
        `همگام‌سازی ناموفق: ${toPersianNumerals(f.length)} مورد به صف خطا منتقل و ${toPersianNumerals(p.length)} مورد در صف ماند.`,
        'error'
      );
    } else {
      showToast(`همگام‌سازی کامل نشد؛ ${toPersianNumerals(p.length)} مورد در انتظار باقی ماند.`, 'warning');
    }
    return { pending: p.length, failed: f.length };
  };

  /** Retry every dead letter: requeue, drain, then report what really happened. */
  const retryAllFailed = async () => {
    setBusy(true);
    const list = await getFailedMutationList();
    for (const m of list) await requeueFailedMutation(m.id);
    setBusy(false);
    await syncNow();
  };

  /**
   * PURGE a queue (پاک‌سازی صف). Destructive, so it always asks first and reports with a
   * neutral icon - never a success checkmark for dropping data.
   */
  const purge = async (kind: 'pending' | 'failed') => {
    const count = kind === 'pending' ? pendingCount : failed.length;
    const confirmResult = await Swal.fire({
      title: kind === 'pending' ? 'پاک‌سازی صف همگام‌سازی' : 'پاک کردن صف خطا',
      html: `<div style="text-align:right;font-size:13px">
              ${toPersianNumerals(count)} مورد از صف ${kind === 'pending' ? 'همگام‌سازی' : 'خطا'} حذف می‌شود و دیگر روی سرور اعمال نخواهد شد.
              ${kind === 'pending' ? '<br/><b>اگر چند دستگاه دارید، ابتدا «همگام‌سازی فوری» را امتحان کنید.</b>' : ''}
            </div>`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'بله، پاک کن',
      cancelButtonText: 'انصراف',
      confirmButtonColor: '#dc2626',
      cancelButtonColor: '#64748b',
    });
    if (!confirmResult.isConfirmed) return;

    setBusy(true);
    if (kind === 'pending') await clearSyncQueue();
    else await clearFailedMutations();
    await refresh();
    setBusy(false);
    showToast(
      kind === 'pending'
        ? `${toPersianNumerals(count)} مورد از صف همگام‌سازی پاک شد.`
        : 'صف خطا پاک شد.',
      'info'
    );
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
        ? 'عملیات ناموفق - برای مشاهده، تلاش مجدد یا پاک‌سازی صف کلیک کنید'
        : status === 'syncing'
          ? 'در حال همگام‌سازی'
          : status === 'pending'
            ? 'در انتظار همگام‌سازی - برای همگام‌سازی فوری یا پاک‌سازی صف کلیک کنید'
            : 'آنلاین - همه‌ی تغییرات همگام شده است';

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

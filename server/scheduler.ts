import { writeAutoBackup, pruneOldBackups } from './services/backup';

// Automated backup scheduler.
//
// Every 12 hours we write a full JSON snapshot into <project root>/backups and
// prune anything older than the 15-day retention window. A single guarded backup
// runs once at startup so a freshly booted server is protected before the first
// scheduled tick. This module only defines/exports the starter; server.ts (owned
// elsewhere) is responsible for calling startBackupScheduler().
//
// NOTE: this intentionally does NOT depend on `node-cron`. That package reads
// `import.meta.url` at module top level, which the CJS production bundle
// (esbuild --format=cjs) rewrites to `undefined` and crashes the server on boot.
// A tiny self-rescheduling timer reproduces the same "00:00 and 12:00" cadence
// with zero dependencies, which also keeps the air-gapped build self-contained.

/** Retention window applied on every scheduled run. */
const RETENTION_DAYS = 15;

/** Half-day cadence, used as a fallback if the clock boundary cannot be computed. */
const PERIOD_MS = 12 * 60 * 60 * 1000;

/** Guard so repeated calls (e.g. dev hot-reload) never register duplicate jobs. */
let started = false;

const runBackup = async (): Promise<void> => {
  try {
    await writeAutoBackup();
    pruneOldBackups(RETENTION_DAYS);
  } catch (e) {
    console.error('[NIR BACKUP CRON]', e);
  }
};

/**
 * Milliseconds from `now` until the next 00:00 or 12:00 local-time boundary.
 * Always returns a strictly positive value so a mis-set clock can never spin.
 */
const msUntilNextBoundary = (now: Date = new Date()): number => {
  const next = new Date(now.getTime());
  next.setSeconds(0, 0);
  next.setMinutes(0);
  if (now.getHours() < 12) {
    next.setHours(12);
  } else {
    next.setHours(24); // next calendar day, 00:00
  }
  const ms = next.getTime() - now.getTime();
  return ms > 0 ? ms : PERIOD_MS;
};

export function startBackupScheduler(): void {
  if (started) return;
  started = true;

  // One backup immediately on startup (fire-and-forget, never blocks boot).
  void runBackup();

  // Then every 12 hours, on the hour (00:00 and 12:00). Each run schedules the
  // next one after it completes, so a long backup can never overlap itself.
  const scheduleNext = (): void => {
    const timer = setTimeout(() => {
      void runBackup().finally(scheduleNext);
    }, msUntilNextBoundary());
    // Do not let the scheduler alone keep the event loop alive; the HTTP server
    // is what keeps the process running.
    if (typeof timer.unref === 'function') timer.unref();
  };
  scheduleNext();

  console.log('[NIR BACKUP CRON] Automated backups enabled (every 12h at 00:00/12:00, 15-day retention).');
}

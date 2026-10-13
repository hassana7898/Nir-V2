import { toGregorian } from './jalali';

/**
 * The «مشاهده روز» hand-off between the global search and the entry/exit pages.
 *
 * WHAT IT DOES
 *   GlobalSearchPage stores the day of a search result, then navigates to /entry or /exit, and the
 *   page opens on that day.
 *
 * WHY IT IS WRITTEN THIS WAY (the broken «مشاهده روز» button)
 *   The value used to be read AND removed inside a `useState` initializer:
 *
 *       const [currentDate, setCurrentDate] = useState(() => {
 *           const saved = sessionStorage.getItem('targetDate');
 *           if (saved) { sessionStorage.removeItem('targetDate'); ... }
 *           return new Date();
 *       });
 *
 *   A state initializer must be PURE. The deployed bundle ships React's DEVELOPMENT build
 *   (`jsxDEV` + `react-dom.development` are both present), so `<React.StrictMode>` intentionally
 *   invokes that initializer TWICE to surface impure renders: the first (discarded) invocation
 *   consumed and deleted the key, the second invocation found nothing and fell back to
 *   `new Date()` — which is exactly why the button always jumped to today (or yesterday).
 *
 *   The hand-off is therefore split into three pure-by-design steps:
 *       setTargetDate(...)  -> peekTargetDate() (repeatable, never clears) -> clearTargetDate()
 *   and the pages clear it from an effect, after the value has been applied.
 *
 * The stored value is always normalised to Gregorian `YYYY-MM-DD`, because the app dates are
 * Jalali text (`1405/07/18`) in places and ISO (`2026-10-10`) in others, and both must open the
 * same day.
 */

const KEY = 'targetDate';

/** The tiny slice of the Storage API we need (keeps this module independent of DOM typings). */
interface MinimalStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

/** sessionStorage when available (private mode / SSR / tests may not have one). */
const storage = (): MinimalStorage | null => {
    try {
        return typeof sessionStorage !== 'undefined' ? (sessionStorage as unknown as MinimalStorage) : null;
    } catch {
        return null;
    }
};

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * Normalise a date that may be Jalali (`1405/07/18`) or ISO (`2026-10-10`, optionally with a time)
 * into Gregorian `YYYY-MM-DD`. Anything unparseable -> null.
 *
 * Years >= 1700 are read as Gregorian, exactly like `dateDayNumber` in shared/jalali does.
 */
export const toIsoText = (value: unknown): string | null => {
    const text = String(value ?? '').trim();
    if (!text) return null;
    const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(text);
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    if (y >= 1700) return `${y}-${pad(mo)}-${pad(d)}`;
    const g = toGregorian(y, mo, d);
    return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
};

/** `YYYY-MM-DD` -> a local NOON Date (noon so no timezone can shift the calendar day). */
export const dateFromIsoDay = (value: unknown): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
    if (!m) return null;
    const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
    return isNaN(date.getTime()) ? null : date;
};

/** Ask the next page to open on `value`'s day. An unusable value just clears any pending day. */
export const setTargetDate = (value: unknown): void => {
    const store = storage();
    if (!store) return;
    try {
        const iso = toIsoText(value);
        if (iso) store.setItem(KEY, iso);
        else store.removeItem(KEY);
    } catch {
        /* storage unavailable/full: the page simply opens on today */
    }
};

/**
 * The pending day as `YYYY-MM-DD`, or null. NEVER clears the key, so it is safe to call from a
 * state initializer (which StrictMode runs twice) and again from an effect.
 */
export const peekTargetDate = (): string | null => {
    const store = storage();
    if (!store) return null;
    try {
        return toIsoText(store.getItem(KEY));
    } catch {
        return null;
    }
};

/** Forget the pending day. Safe to call repeatedly, and only AFTER the value has been applied. */
export const clearTargetDate = (): void => {
    const store = storage();
    if (!store) return;
    try {
        store.removeItem(KEY);
    } catch {
        /* ignore */
    }
};

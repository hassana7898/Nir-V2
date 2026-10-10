import Swal from 'sweetalert2';
import { textMatchKey } from '../shared/persianText';

/**
 * The word the user must type to unlock a destructive action.
 * Chosen to be short, unambiguous in Persian, and impossible to produce by an accidental keystroke.
 */
export const TYPED_DELETE_WORD = 'تایید';

export interface TypedDeleteOptions {
    title: string;
    /** Extra warning HTML shown above the input (already-sanitised strings only). */
    html?: string;
    /** Override the word (defaults to «تایید»). */
    word?: string;
    confirmButtonText?: string;
}

/**
 * STRICT confirmation for destructive actions.
 *
 * The confirm button is DISABLED until the user has typed the exact word, and `preConfirm` enforces
 * the same rule a second time (so Enter/submit cannot bypass it). Text is compared with the shared
 * Persian normaliser, so «تایيد» with an Arabic ي still counts as the typed word.
 *
 * @returns true only when the user both typed the word and pressed the (then-enabled) button.
 */
export const confirmTypedDelete = async (options: TypedDeleteOptions): Promise<boolean> => {
    const word = options.word || TYPED_DELETE_WORD;
    const expected = textMatchKey(word);

    const result = await Swal.fire({
        title: options.title,
        html: `${options.html || ''}
            <div style="text-align:right;margin-top:14px">
                <label style="display:block;font-size:13px;color:#b91c1c;font-weight:bold;margin-bottom:6px">
                    برای تأیید، عبارت «${word}» را تایپ کنید:
                </label>
                <input id="nir-typed-confirm" class="swal2-input" autocomplete="off" spellcheck="false"
                       style="margin:0;width:100%;direction:rtl;text-align:center;font-weight:bold" placeholder="${word}" />
                <div id="nir-typed-hint" style="font-size:11px;color:#64748b;margin-top:6px">
                    دکمه حذف تا تایپ کامل عبارت غیرفعال است.
                </div>
            </div>`,
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: options.confirmButtonText || 'حذف قطعی',
        cancelButtonText: 'انصراف',
        confirmButtonColor: '#dc2626',
        cancelButtonColor: '#64748b',
        focusConfirm: false,
        allowOutsideClick: false,
        didOpen: (popup) => {
            const input = popup.querySelector<HTMLInputElement>('#nir-typed-confirm');
            const hint = popup.querySelector<HTMLElement>('#nir-typed-hint');
            const confirmButton = Swal.getConfirmButton();
            if (confirmButton) confirmButton.disabled = true; // locked until the word is typed

            const sync = () => {
                const matches = textMatchKey(input?.value || '') === expected;
                if (confirmButton) confirmButton.disabled = !matches;
                if (hint) {
                    hint.textContent = matches
                        ? 'عبارت تأیید شد؛ دکمه حذف فعال است.'
                        : 'دکمه حذف تا تایپ کامل عبارت غیرفعال است.';
                    hint.style.color = matches ? '#047857' : '#64748b';
                }
            };

            input?.addEventListener('input', sync);
            input?.addEventListener('paste', () => window.setTimeout(sync, 0));
            window.setTimeout(() => input?.focus(), 50);
            sync();
        },
        preConfirm: () => {
            // Second gate: nothing (Enter, programmatic click, ...) can bypass the typed word.
            const input = Swal.getPopup()?.querySelector<HTMLInputElement>('#nir-typed-confirm');
            if (textMatchKey(input?.value || '') !== expected) {
                Swal.showValidationMessage(`برای ادامه باید عبارت «${word}» را تایپ کنید.`);
                return false;
            }
            return true;
        },
    });

    return result.isConfirmed;
};


export const toPersianNumerals = (str: string | number | null | undefined): string => {
    if (str === null || str === undefined) return '';
    const persian = { '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴', '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹' };
    return str.toString().replace(/[0-9]/g, (w) => persian[w as keyof typeof persian]);
};

export const formatDate = (date: Date | string): string => {
    let d: Date;
    if (typeof date === 'string') {
        if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            d = new Date(`${date}T12:00:00`);
        } else {
            d = new Date(date);
        }
    } else {
        d = date;
    }
    return d.toLocaleDateString('fa-IR');
};

export const formatDateWithWeekday = (date: Date | string): string => {
    let d: Date;
    if (typeof date === 'string') {
        if (date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            d = new Date(`${date}T12:00:00`);
        } else {
            d = new Date(date);
        }
    } else {
        d = date;
    }
    
    const datePart = new Intl.DateTimeFormat('fa-IR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(d);
    
    const weekday = new Intl.DateTimeFormat('fa-IR', { weekday: 'long' }).format(d);
    
    return toPersianNumerals(`${datePart} ${weekday}`);
};

export const formatDateTime = (timestamp: number): string => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return toPersianNumerals(date.toLocaleString('fa-IR'));
};

export const formatToISODate = (date: Date): string => {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().split('T')[0];
};

export const formatCurrency = (value: number | null | undefined): string => {
    if (!value) return '-';
    return `${toPersianNumerals(Number(value).toLocaleString('fa-IR'))} ریال`;
};

export const formatWastage = (value: number | null | undefined): string => {
    const num = Number(value || 0);
    if (num > 0) {
        return `+${toPersianNumerals(num.toLocaleString('fa-IR'))}`;
    }
    return toPersianNumerals(num.toLocaleString('fa-IR'));
};

export const formatIBANForDisplay = (iban: string | null | undefined): string => {
    if (!iban) return '-';
    const clean = iban.toString().replace(/\D/g, '');
    
    if (clean.length === 16) {
        // Format as card number: XXXX-XXXX-XXXX-XXXX
        return toPersianNumerals(clean.match(/.{1,4}/g)?.join('-') || clean);
    }
    
    if (iban.toString().toUpperCase().startsWith('IR')) {
        return toPersianNumerals(iban.toString().toUpperCase());
    }
    
    return toPersianNumerals(iban);
};

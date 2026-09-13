
const PASSWORD_HASH_KEY = 'poultryAppPasswordHash';
const PASSWORD_SALT_KEY = 'poultryAppPasswordSalt';
const SESSION_KEY = 'poultryAppSession';

const bufferToHex = (buffer: ArrayBuffer): string => {
    return [...new Uint8Array(buffer)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

const hexToBuffer = (hex: string): ArrayBuffer => {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes.buffer;
};

const hashPassword = async (password: string, salt: string): Promise<string> => {
    const data = new TextEncoder().encode(password + salt);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return bufferToHex(hashBuffer);
};

export const isPasswordSet = (): boolean => {
    return localStorage.getItem(PASSWORD_HASH_KEY) !== null;
};

export const setPassword = async (password: string): Promise<void> => {
    const salt = bufferToHex(crypto.getRandomValues(new Uint8Array(16)));
    const hash = await hashPassword(password, salt);
    localStorage.setItem(PASSWORD_SALT_KEY, salt);
    localStorage.setItem(PASSWORD_HASH_KEY, hash);
};

export const verifyPassword = async (password: string): Promise<boolean> => {
    const salt = localStorage.getItem(PASSWORD_SALT_KEY);
    const storedHash = localStorage.getItem(PASSWORD_HASH_KEY);
    if (!salt || !storedHash) {
        return false;
    }
    const hash = await hashPassword(password, salt);
    return hash === storedHash;
};

export const login = (): void => {
    sessionStorage.setItem(SESSION_KEY, 'true');
};

export const logout = (): void => {
    sessionStorage.removeItem(SESSION_KEY);
};

export const isAuthenticated = (): boolean => {
    return sessionStorage.getItem(SESSION_KEY) === 'true';
};

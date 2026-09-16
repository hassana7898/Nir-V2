import React, { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from '../utils/helpers';

const LoginPage: React.FC = () => {
    // Username defaults to the primary account so the admin flow is one field away,
    // while still allowing the read-only `viewer` account (created by RBAC) to sign in.
    const [username, setUsername] = useState('admin');
    const [password, setPassword] = useState('');
    const [twoFactorRequired, setTwoFactorRequired] = useState(false);
    const [code, setCode] = useState('');
    const [rememberDevice, setRememberDevice] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();

    // Step 1: verify the password. If the server answers `twoFactorRequired`, reveal the
    // second step (the 6-digit authenticator code) inside the same card.
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        const outcome = await login(username, password);
        if (outcome.success) {
            // The app re-renders to the dashboard automatically.
            return;
        }
        if (outcome.twoFactorRequired) {
            setTwoFactorRequired(true);
            setLoading(false);
            return;
        }
        const message = outcome.error || 'رمز عبور اشتباه است';
        setError(message);
        showToast(message, 'error');
        setLoading(false);
    };

    // Step 2: submit the 2FA code (optionally remembering this device for 30 days).
    const handleTwoFactorSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (code.length !== 6) {
            setError('کد تأیید باید ۶ رقم باشد');
            return;
        }
        setError('');
        setLoading(true);
        const outcome = await login(username, password, { totp: code, rememberDevice });
        if (outcome.success) {
            return;
        }
        const message = outcome.error || 'کد تأیید دو مرحله‌ای نادرست است';
        setError(message);
        showToast(message, 'error');
        setLoading(false);
    };

    const handleBackToPassword = () => {
        setTwoFactorRequired(false);
        setCode('');
        setError('');
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-100 px-4">
            <div className="p-8 bg-white rounded-xl shadow-md w-full max-w-sm">
                <h1 className="text-2xl font-bold text-center text-slate-700 mb-6">ورود به سامانه</h1>

                {!twoFactorRequired ? (
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div>
                            <label htmlFor="username" className="block text-sm font-medium text-slate-600 mb-1">نام کاربری</label>
                            <input
                                id="username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full p-3 border rounded-lg text-center"
                                autoComplete="username"
                                dir="ltr"
                                placeholder="admin"
                                required
                                autoFocus
                            />
                        </div>
                        <div>
                            <label htmlFor="password" className="block text-sm font-medium text-slate-600 mb-1">رمز عبور</label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full p-3 border rounded-lg text-center"
                                required
                            />
                             {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-sky-500 text-white p-3 rounded-lg hover:bg-sky-600 transition-colors disabled:bg-sky-300"
                        >
                            {loading ? 'در حال بررسی...' : 'ورود'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleTwoFactorSubmit} className="space-y-5">
                        <div>
                            <label htmlFor="totp" className="block text-sm font-medium text-slate-600 mb-1">کد تأیید دو مرحله‌ای</label>
                            <input
                                id="totp"
                                type="text"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength={6}
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                className="w-full p-3 border rounded-lg text-center text-lg tracking-[0.5em]"
                                dir="ltr"
                                placeholder="------"
                                required
                                autoFocus
                            />
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={rememberDevice}
                                onChange={(e) => setRememberDevice(e.target.checked)}
                                className="w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
                            />
                            <span className="text-sm text-slate-600">مرا در این دستگاه به خاطر بسپار <span className="text-xs text-slate-400">(۳۰ روز)</span></span>
                        </label>

                        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-sky-500 text-white p-3 rounded-lg hover:bg-sky-600 transition-colors disabled:bg-sky-300"
                        >
                            {loading ? 'در حال بررسی...' : 'تأیید و ورود'}
                        </button>
                        <button
                            type="button"
                            onClick={handleBackToPassword}
                            className="w-full text-slate-500 text-sm hover:text-slate-700"
                        >
                            بازگشت
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
};

export default LoginPage;

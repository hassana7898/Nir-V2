
import React, { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from '../utils/helpers';

const SetupPage: React.FC = () => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { setupPassword } = useAuth();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (password.length < 4) {
            setError('رمز عبور باید حداقل ۴ کاراکتر باشد.');
            return;
        }
        if (password !== confirmPassword) {
            setError('رمزهای عبور یکسان نیستند.');
            return;
        }

        setError('');
        setLoading(true);
        try {
            await setupPassword(password);
            showToast('رمز عبور با موفقیت تنظیم شد!', 'success');
            // The app will re-render to the login page automatically
        } catch (err) {
            setError('خطا در تنظیم رمز عبور.');
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-100">
            <div className="p-8 bg-white rounded-xl shadow-md w-full max-w-sm">
                <h1 className="text-2xl font-bold text-center text-slate-700 mb-2">راه‌اندازی اولیه</h1>
                <p className="text-sm text-center text-slate-500 mb-6">برای امنیت، لطفا یک رمز عبور برای برنامه تنظیم کنید.</p>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">رمز عبور جدید</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full p-3 border rounded-lg text-center"
                            required
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-600 mb-1">تکرار رمز عبور</label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full p-3 border rounded-lg text-center"
                            required
                        />
                    </div>
                    {error && <p className="text-red-500 text-sm mt-2 text-center">{error}</p>}
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-sky-500 text-white p-3 rounded-lg hover:bg-sky-600 transition-colors disabled:bg-sky-300"
                    >
                        {loading ? 'در حال ذخیره‌سازی...' : 'تنظیم رمز عبور'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default SetupPage;

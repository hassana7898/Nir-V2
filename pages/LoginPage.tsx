
import React, { useState, FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { showToast } from '../utils/helpers';

const LoginPage: React.FC = () => {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        const success = await login(password);
        if (!success) {
            setError('رمز عبور اشتباه است');
            showToast('رمز عبور اشتباه است', 'error');
            setLoading(false);
        }
    };

    return (
        <div className="flex items-center justify-center min-h-screen bg-slate-100">
            <div className="p-8 bg-white rounded-xl shadow-md w-full max-w-sm">
                <h1 className="text-2xl font-bold text-center text-slate-700 mb-6">ورود به سامانه</h1>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-slate-600 mb-1">رمز عبور</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full p-3 border rounded-lg text-center"
                            required
                            autoFocus
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
            </div>
        </div>
    );
};

export default LoginPage;

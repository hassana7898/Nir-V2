
import React, { useState, useEffect } from 'react';
import { Log } from '../types';
import * as dataService from '../services/dataService';
import { formatDateTime } from '../utils/formatters';

const LogPage: React.FC = () => {
    const [logs, setLogs] = useState<Log[]>([]);

    useEffect(() => {
        const fetchedLogs = dataService.getLogs();
        setLogs(fetchedLogs);
    }, []);

    const getActionColor = (action: Log['action']) => {
        switch (action) {
            case 'created': return 'text-green-600';
            case 'updated':
            case 'moved':
            case 'bulkMoved': return 'text-blue-600';
            case 'deleted': return 'text-red-600';
            default: return 'text-gray-600';
        }
    }

    return (
        <div className="bg-white p-5 rounded-xl shadow-md">
            <h1 className="text-2xl font-bold text-slate-700 mb-4">سابقه فعالیت‌ها</h1>
             <div className="overflow-x-auto max-h-[calc(100vh-150px)] overflow-y-auto">
                 <table className="w-full text-sm text-left">
                     <thead className="bg-slate-100 sticky top-0">
                         <tr>
                             <th className="p-3 text-right">زمان</th>
                             <th className="p-3 text-right">عملیات</th>
                             <th className="p-3 text-right">جزئیات</th>
                         </tr>
                    </thead>
                    <tbody>
                        {logs.length > 0 ? logs.map((log, index) => (
                            <tr key={index} className="border-b">
                                <td className="p-3 text-slate-500 font-mono text-left" dir="ltr">{formatDateTime(log.timestamp)}</td>
                                <td className={`p-3 font-semibold ${getActionColor(log.action)}`}>{log.actionText}</td>
                                <td className="p-3 text-slate-700">{log.details}</td>
                            </tr>
                        )) : (
                            <tr>
                                <td colSpan={3} className="text-center p-4 text-slate-500">هیچ سابقه‌ای یافت نشد.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default LogPage;

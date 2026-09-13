import React, { useState, useEffect } from 'react';
import * as dataService from '../services/dataService';
import { toPersianNumerals } from '../utils/formatters';
import * as Recharts from 'recharts';

const BroodIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
);

const InventoryIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
    </svg>
);

const ProductionIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.512 1.422l-1.636 2.182a2.25 2.25 0 00.34 3.242l3.242 1.891a2.25 2.25 0 003.242 0l3.242-1.89a2.25 2.25 0 00.34-3.242l-1.636-2.182a2.25 2.25 0 01-.512-1.422V3.104a2.25 2.25 0 00-3.242 0l-1.89 1.099a2.25 2.25 0 01-3.242 0l-1.89-1.099a2.25 2.25 0 00-3.242 0z" />
    </svg>
);

const EntryExitIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m-3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
);


// Custom Tooltip for charts to avoid potential compatibility issues with React 19/StrictMode
const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
        return (
            <div className="bg-white p-3 rounded-lg shadow-lg border border-slate-200" style={{ fontFamily: 'Sahel' }}>
                {label && <p className="label font-semibold mb-1">{toPersianNumerals(label)}</p>}
                {payload.map((pld: any, index: number) => (
                    <div key={index} style={{ color: pld.color || pld.payload.fill }}>
                        {`${toPersianNumerals(pld.name)}: ${toPersianNumerals(pld.value.toLocaleString())} kg`}
                    </div>
                ))}
            </div>
        );
    }
    return null;
};


const DashboardPage: React.FC = () => {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [chartDays, setChartDays] = useState(7);
    const [chartView, setChartView] = useState<'both' | 'entry' | 'exit'>('both');
    
    useEffect(() => {
        try {
            setLoading(true);
            const dashboardData = dataService.getDashboardData(chartDays);
            setData(dashboardData);
        } catch (error) {
            console.error("Failed to load dashboard data", error);
        } finally {
            setLoading(false);
        }
    }, [chartDays]);

    if (loading && !data) {
        return <div className="text-center p-10">در حال بارگذاری...</div>;
    }
    
    if (!data) {
        return <div className="text-center p-10">خطا در بارگذاری اطلاعات داشبورد.</div>;
    }

    const COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    
    const formatLegendValue = (value: string) => {
        if (value === 'entry') return 'ورود';
        if (value === 'exit') return 'خروج (محصول نهایی)';
        return value;
    };

    const renderChart = () => {
        if (loading) return <div className="flex items-center justify-center h-[300px]">در حال بروزرسانی نمودار...</div>;
        return (
             <Recharts.ResponsiveContainer width="100%" height={300}>
                <Recharts.LineChart data={data.lastDaysData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <Recharts.CartesianGrid strokeDasharray="3 3" />
                    <Recharts.XAxis dataKey="date" tickFormatter={toPersianNumerals}/>
                    <Recharts.YAxis tickFormatter={(val) => toPersianNumerals(val / 1000) + ' تن'}/>
                    <Recharts.Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(230, 230, 230, 0.5)' }} />
                    <Recharts.Legend wrapperStyle={{ fontFamily: 'Sahel' }} formatter={formatLegendValue} />
                    {(chartView === 'both' || chartView === 'entry') && <Recharts.Line type="monotone" dataKey="entry" stroke="#10b981" name="ورود" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }}/>}
                    {(chartView === 'both' || chartView === 'exit') && <Recharts.Line type="monotone" dataKey="exit" stroke="#ef4444" name="خروج (محصول نهایی)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }}/>}
                </Recharts.LineChart>
            </Recharts.ResponsiveContainer>
        );
    };

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold text-slate-800">داشبورد</h1>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-5 rounded-xl shadow-md flex items-center gap-4">
                    <div className="bg-sky-100 p-3 rounded-full"> <BroodIcon className="h-8 w-8 text-sky-600"/> </div>
                    <div>
                        <p className="text-slate-500 text-sm">دوره‌های فعال</p>
                        <p className="text-2xl font-bold">{toPersianNumerals(data.activeBroodsCount)}</p>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-md flex items-center gap-4">
                    <div className="bg-green-100 p-3 rounded-full"> <InventoryIcon className="h-8 w-8 text-green-600"/> </div>
                    <div>
                        <p className="text-slate-500 text-sm">موجودی مواد اولیه</p>
                        <p className="text-2xl font-bold">{toPersianNumerals(Math.round(data.rawMaterialWeight).toLocaleString())} <span className="text-sm font-normal text-slate-500">کیلوگرم</span></p>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-md flex items-center gap-4">
                     <div className="bg-indigo-100 p-3 rounded-full"> <ProductionIcon className="h-8 w-8 text-indigo-600"/> </div>
                    <div>
                        <p className="text-slate-500 text-sm">موجودی محصول نهایی</p>
                        <p className="text-2xl font-bold">{toPersianNumerals(Math.round(data.finishedGoodWeight).toLocaleString())} <span className="text-sm font-normal text-slate-500">کیلوگرم</span></p>
                    </div>
                </div>
                <div className="bg-white p-5 rounded-xl shadow-md flex items-center gap-4">
                     <div className="bg-yellow-100 p-3 rounded-full"> <EntryExitIcon className="h-8 w-8 text-yellow-600"/> </div>
                    <div>
                        <p className="text-slate-500 text-sm">حواله‌های امروز</p>
                        <p className="text-xl font-bold">
                            <span className="text-green-600">{toPersianNumerals(data.todayEntriesCount)} ورود</span> / <span className="text-red-600">{toPersianNumerals(data.todayExitsCount)} خروج</span>
                        </p>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 bg-white p-5 rounded-xl shadow-md">
                    <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
                        <h2 className="text-lg font-bold text-slate-700">ورود و خروج وزنی</h2>
                        <div className="flex items-center gap-2 text-sm">
                            <div className="flex items-center bg-slate-100 p-1 rounded-lg">
                                <button onClick={() => setChartDays(7)} className={`px-3 py-1 rounded-md ${chartDays === 7 ? 'bg-white shadow-sm' : ''}`}>۷ روز</button>
                                <button onClick={() => setChartDays(30)} className={`px-3 py-1 rounded-md ${chartDays === 30 ? 'bg-white shadow-sm' : ''}`}>۳۰ روز</button>
                            </div>
                             <div className="flex items-center bg-slate-100 p-1 rounded-lg">
                                <button onClick={() => setChartView('both')} className={`px-3 py-1 rounded-md ${chartView === 'both' ? 'bg-white shadow-sm' : ''}`}>هردو</button>
                                <button onClick={() => setChartView('entry')} className={`px-3 py-1 rounded-md ${chartView === 'entry' ? 'bg-white shadow-sm' : ''}`}>ورود</button>
                                <button onClick={() => setChartView('exit')} className={`px-3 py-1 rounded-md ${chartView === 'exit' ? 'bg-white shadow-sm' : ''}`}>خروج</button>
                            </div>
                        </div>
                    </div>
                    {renderChart()}
                </div>

                <div className="bg-white p-5 rounded-xl shadow-md">
                     <h2 className="text-lg font-bold text-slate-700 mb-4">ترکیب موجودی مواد اولیه</h2>
                     {data.rawMaterialDistribution.length > 0 ? (
                        <Recharts.ResponsiveContainer width="100%" height={300}>
                            <Recharts.PieChart>
                                <Recharts.Pie
                                    data={data.rawMaterialDistribution}
                                    dataKey="value"
                                    nameKey="name"
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={110}
                                    fill="#8884d8"
                                    labelLine={false}
                                    label={({ cx, cy, midAngle, innerRadius, outerRadius, percent }) => {
                                        const radius = innerRadius + (outerRadius - innerRadius) * 0.5;
                                        const x = cx + radius * Math.cos(-midAngle * (Math.PI / 180));
                                        const y = cy + radius * Math.sin(-midAngle * (Math.PI / 180));
                                        if (percent < 0.05) return null;
                                        return (
                                            <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize="12px" fontWeight="bold">
                                                {`%${toPersianNumerals((percent * 100).toFixed(0))}`}
                                            </text>
                                        );
                                    }}
                                >
                                    {data.rawMaterialDistribution.map((entry: any, index: number) => (
                                        <Recharts.Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Recharts.Pie>
                                <Recharts.Tooltip content={<CustomTooltip />} />
                                <Recharts.Legend wrapperStyle={{ fontFamily: 'Sahel' }} formatter={(value) => toPersianNumerals(value)} />
                            </Recharts.PieChart>
                        </Recharts.ResponsiveContainer>
                     ) : (
                        <div className="flex items-center justify-center h-full text-slate-500">موجودی مواد اولیه صفر است.</div>
                     )}
                </div>
            </div>
        </div>
    );
}

export default DashboardPage;
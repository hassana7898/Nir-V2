
import React from 'react';
import { NavLink } from 'react-router-dom';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';

const Sidebar: React.FC = () => {
    const { settings } = useSettings();
    const { logout } = useAuth();
    
    const navLinkClass = ({ isActive }: { isActive: boolean }): string => {
        return `flex items-center p-3 rounded-lg mb-2 transition-colors ${isActive ? 'bg-slate-700' : 'hover:bg-sky-600'}`;
    };

    return (
        <aside className="w-64 bg-slate-800 text-white p-4 flex flex-col no-print">
            <div className="text-2xl font-bold mb-8 text-center border-b border-slate-600 pb-4">
                <span>{settings.factoryName}</span>
            </div>
            <nav className="flex-grow">
                <NavLink to="/dashboard" className={navLinkClass}>
                    <DashboardIcon className="h-6 w-6 ml-3" />
                    <span>داشبورد</span>
                </NavLink>
                <NavLink to="/entry" className={navLinkClass}>
                    <EntryIcon className="h-6 w-6 ml-3" />
                    <span>حواله ورود</span>
                </NavLink>
                <NavLink to="/exit" className={navLinkClass}>
                    <ExitIcon className="h-6 w-6 ml-3" />
                    <span>حواله خروج</span>
                </NavLink>
                 <NavLink to="/farmers" className={navLinkClass}>
                    <FarmerIcon className="h-6 w-6 ml-3" />
                    <span>مدیریت مرغداران</span>
                </NavLink>
                <NavLink to="/broods" className={navLinkClass}>
                    <BroodIcon className="h-6 w-6 ml-3" />
                    <span>مدیریت دوره‌ها</span>
                </NavLink>
                <NavLink to="/inventory" className={navLinkClass}>
                    <InventoryIcon className="h-6 w-6 ml-3" />
                    <span>انبارداری</span>
                </NavLink>
                 <NavLink to="/inventory-analysis" className={navLinkClass}>
                    <AnalysisIcon className="h-6 w-6 ml-3" />
                    <span>آنالیز انبار</span>
                </NavLink>
                <NavLink to="/production" className={navLinkClass}>
                    <ProductionIcon className="h-6 w-6 ml-3" />
                    <span>تولید</span>
                </NavLink>
                <NavLink to="/global-search" className={navLinkClass}>
                    <SearchIcon className="h-6 w-6 ml-3" />
                    <span>جستجوی سراسری</span>
                </NavLink>
                <NavLink to="/reports" className={navLinkClass}>
                    <ReportsIcon className="h-6 w-6 ml-3" />
                    <span>گزارش‌گیری</span>
                </NavLink>
                <NavLink to="/log" className={navLinkClass}>
                    <LogIcon className="h-6 w-6 ml-3" />
                    <span>سابقه فعالیت</span>
                </NavLink>
                <NavLink to="/settings" className={navLinkClass}>
                    <SettingsIcon className="h-6 w-6 ml-3" />
                    <span>تنظیمات</span>
                </NavLink>
            </nav>
            <div className="mt-auto">
                <button onClick={logout} className="flex items-center p-3 rounded-lg mb-2 transition-colors w-full text-right hover:bg-red-800">
                    <LogoutIcon className="h-6 w-6 ml-3" />
                    <span>خروج از حساب</span>
                </button>
                <div className="text-xs text-slate-400 text-center mt-2">
                    <p>حالت: <span>آفلاین</span></p>
                </div>
            </div>
        </aside>
    );
};

// SVG Icon Components
const DashboardIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
    </svg>
);

const EntryIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
    </svg>
);

const ExitIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H3m5 4v1a3 3 0 003 3h7a3 3 0 003-3V7a3 3 0 00-3-3H6a3 3 0 00-3 3v1" />
    </svg>
);

const FarmerIcon = (props: React.SVGProps<SVGSVGElement>) => (
     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.071M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-4.663M5.042 15.34c0-1.113.285-2.16.786-3.071M5.042 15.34v-.003a6.375 6.375 0 0111.964-4.663m-11.964 4.664v.106A12.318 12.318 0 008.624 21c2.331 0 4.512-.645 6.374-1.766l.001-.109a6.375 6.375 0 00-11.964-4.663M9 4.5a3 3 0 116 0 3 3 0 01-6 0z" />
    </svg>
);

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

const AnalysisIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h12A2.25 2.25 0 0020.25 14.25V3M3.75 21h16.5M16.5 3.75h.008v.008H16.5V3.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 12h9M7.5 7.5h4.5M12 16.5V21" />
    </svg>
);


const ProductionIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.512 1.422l-1.636 2.182a2.25 2.25 0 00.34 3.242l3.242 1.891a2.25 2.25 0 003.242 0l3.242-1.89a2.25 2.25 0 00.34-3.242l-1.636-2.182a2.25 2.25 0 01-.512-1.422V3.104a2.25 2.25 0 00-3.242 0l-1.89 1.099a2.25 2.25 0 01-3.242 0l-1.89-1.099a2.25 2.25 0 00-3.242 0z" />
    </svg>
);

const SearchIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
);

const ReportsIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2m15-10h2a4 4 0 014 4v2M9 17a4 4 0 014 4h2a4 4 0 014-4v-2M5 7a4 4 0 014-4h2a4 4 0 014 4v2" />
    </svg>
);

const LogIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
);

const SettingsIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924-1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);

const LogoutIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" {...props}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m-3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
);


export default Sidebar;

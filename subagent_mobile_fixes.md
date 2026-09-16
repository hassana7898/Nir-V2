# Mobile Responsiveness Fix Report

Project root: `.openclaw/tmp/nirv2`
Scope: className / inline-style changes only. No git, npm, build, or file moves run.
All Persian text preserved (verified: 0 U+FFFD replacement chars per file).

---

## 1) pages/ReportsPage.tsx

**1a. Grouped-results card wrapper**
- OLD: `className="border rounded-lg overflow-hidden"`
- NEW: `className="border rounded-lg"`
- Context: `<div key={groupKey} ...>` inside `renderGroupedResults` (removed `overflow-hidden` so the horizontal table scroll is no longer clipped).
- Verified by re-read: `className="border rounded-lg"` present (n=1); `overflow-hidden` no longer occurs anywhere in this file (n=0).

**1b. Results table (renderFlatTable)**
- OLD: `<table className="w-full text-sm text-center">`
- NEW: `<table className="w-full min-w-[1000px] whitespace-nowrap text-sm text-center">`
- Verified by re-read: new string present (n=1); Persian header cells (`تاریخ`, `نوع`, ...) intact.

---

## 2) pages/ExitPage.tsx

- OLD: `<table className="w-full text-sm text-center border-collapse border border-slate-800">`
- NEW: `<table className="w-full min-w-[760px] whitespace-nowrap text-sm text-center border-collapse border border-slate-800">`
- Verified by re-read: new string present (n=1); Persian th text (`ردیف`, `نام مرغدار`, `نوع محصول`, `وزن`, `نام راننده`, `شماره حواله`, `عملیات`) intact.

---

## 3) pages/EntryPage.tsx

- OLD: `<table className="w-full text-[13px] text-center border-collapse">`
- NEW: `<table className="w-full min-w-[900px] whitespace-nowrap text-[13px] text-center border-collapse">`
- Verified by re-read: new string present (n=1); Persian strings intact.

---

## 4) pages/GlobalSearchPage.tsx

- OLD: `<table className="w-full text-sm text-center border-collapse">`
- NEW: `<table className="w-full min-w-[1000px] text-sm text-center border-collapse">`
- Verified by re-read: new string present (n=1).

---

## 5) pages/InventoryAnalysisPage.tsx

- OLD: `<table id="analysis-table" className="w-full text-sm text-center">`
- NEW: `<table id="analysis-table" className="w-full min-w-[820px] whitespace-nowrap text-sm text-center">`
- Verified by re-read: new string present (n=1); `id="analysis-table"` preserved.

---

## 6) components/BroodDetailsCard.tsx

**6a. Scroll wrapper**
- OLD: `className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar pr-1"`
- NEW: `className="space-y-2 max-h-60 overflow-y-auto overflow-x-auto custom-scrollbar pr-1"`
- Verified by re-read: `overflow-x-auto custom-scrollbar` present (n=1).

**6b. Inner table**
- OLD: `<table className="w-full text-center text-xs">`
- NEW: `<table className="w-full min-w-[420px] whitespace-nowrap text-center text-xs">`
- Verified by re-read: new string present (n=1); Persian headers (`نوع`, `تاریخ`, `وزن (kg)`, `جزئیات`, `عملیات`) intact.

---

## 7) pages/LoginPage.tsx

- OLD: `className="flex items-center justify-center min-h-screen bg-slate-100"`
- NEW: `className="flex items-center justify-center min-h-screen bg-slate-100 px-4"`
- Verified by re-read: new string present (n=1); Persian text (`ورود به سامانه`, `رمز عبور`) intact.

---

## 8) pages/SetupPage.tsx

- OLD: `className="flex items-center justify-center min-h-screen bg-slate-100"`
- NEW: `className="flex items-center justify-center min-h-screen bg-slate-100 px-4"`
- Verified by re-read: new string present (n=1); Persian text (`راه‌اندازی اولیه`, `رمز عبور جدید`) intact.

---

## 9) components/Modal.tsx

**9a. Footer (no longer scrolls away, wraps on small screens, opaque background kept)**
- OLD: `className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-xl flex justify-end gap-2"`
- NEW: `className="p-4 border-t border-slate-100 bg-slate-50 rounded-b-xl flex flex-wrap justify-end gap-2 sticky bottom-0"`
- Note: footer already had `bg-slate-50` (opaque), so no extra `bg-white` was needed.
- Verified by re-read: `flex flex-wrap justify-end gap-2 sticky bottom-0` present (n=1).

**9b. Close button tap target**
- OLD: `className="text-slate-400 hover:text-red-500 transition-colors text-2xl leading-none"`
- NEW: `className="text-slate-400 hover:text-red-500 transition-colors text-2xl leading-none p-2"`
- Verified by re-read: `leading-none p-2` present (n=1).

---

## 10) pages/SettingsPage.tsx

**10a. Password-change inputs (3x, inside the «تغییر رمز عبور» form)**
- OLD: `className="w-full p-2 border rounded-lg"` (on `value={currentPassword}` / `value={newPassword}` / `value={confirmPassword}`)
- NEW: `className="w-full p-3 border rounded-lg min-h-[44px]"`
- Verified by re-read: `w-full p-3 border rounded-lg min-h-[44px]` present exactly 3 times (n=3).

**10b. 2FA code input**
- OLD: `className="w-full p-2 border rounded-lg text-center tracking-[0.5em]"`
- NEW: `className="w-full p-2 border rounded-lg min-h-[40px] text-center tracking-[0.5em]"`
- Verified by re-read: `min-h-[40px] text-center tracking-[0.5em]` present (n=1).

**10c. 2FA buttons (Verify + Cancel) — min tap-height bumped**
- Verify OLD: `className="flex-1 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 disabled:bg-green-300"`
- Verify NEW: `className="flex-1 bg-green-500 text-white px-4 py-2 min-h-[40px] rounded-lg hover:bg-green-600 disabled:bg-green-300"`
- Cancel OLD: `className="px-4 py-2 rounded-lg border text-slate-600 hover:bg-slate-100"`
- Cancel NEW: `className="px-4 py-2 min-h-[40px] rounded-lg border text-slate-600 hover:bg-slate-100"`
- Verified by re-read: both buttons now carry `min-h-[40px]`.
- NOTE: these buttons already had `py-2` (no `py-1`); only `min-h-[40px]` was added. See "Remaining/uncertain" item 1.

**10d. Backups-table Restore button**
- OLD: `className="bg-amber-500 text-white px-3 py-1 rounded-lg hover:bg-amber-600 disabled:bg-amber-300 whitespace-nowrap"`
- NEW: `className="bg-amber-500 text-white px-3 py-2 min-h-[40px] rounded-lg hover:bg-amber-600 disabled:bg-amber-300 whitespace-nowrap"`
- Verified by re-read: `py-2 min-h-[40px] rounded-lg hover:bg-amber-600` present (n=1); old `px-3 py-1 rounded-lg` gone (n=0); Persian label `بازیابی` intact.

**10e. Product rows (مدیریت و ترتیب محصولات) — responsive grid + children**
- Grid OLD: `<div key={product.id} className="grid grid-cols-12 gap-2 items-center">`
- Grid NEW: `<div key={product.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center">`
- Child OLD: `className="col-span-1 flex justify-center items-center cursor-grab drag-handle text-slate-400 hover:text-slate-700"` → NEW: `className="col-span-12 md:col-span-1 flex justify-center items-center cursor-grab drag-handle text-slate-400 hover:text-slate-700"`
- Child OLD: `className="col-span-5 p-2 border rounded-lg bg-slate-50 flex justify-between items-center"` → NEW: `className="col-span-12 md:col-span-5 p-2 border rounded-lg bg-slate-50 flex justify-between items-center"`
- Child OLD: `className="col-span-4 p-2 border rounded-lg"` (the product-type `<select>`) → NEW: `className="col-span-12 md:col-span-4 p-2 border rounded-lg"`
- Child OLD: `className="col-span-2 bg-red-500 text-white p-2 rounded-lg hover:bg-red-600"` (delete button) → NEW: `className="col-span-12 md:col-span-2 bg-red-500 text-white p-2 rounded-lg hover:bg-red-600"`
- Verified by re-read: `grid grid-cols-1 md:grid-cols-12 gap-2 items-center` (n=1); `col-span-12 md:col-span-1` (n=1); `col-span-12 md:col-span-5` (n=1); `col-span-12 md:col-span-4` (n=1); `col-span-12 md:col-span-2` (n=1); old `grid grid-cols-12 gap-2 items-center` gone (n=0); Persian labels (`حذف`, `ویرایش`, `ماده اولیه`, `محصول نهایی`) intact. Only that product-row grid was touched.

---

## 11) pages/ProductionPage.tsx

**11a. Record-production row**
- OLD: `className="flex items-end gap-4"`
- NEW: `className="flex flex-col md:flex-row md:items-end gap-4"`
- Verified by re-read: new string present (n=1); old string gone (n=0).

**11b. Field wrappers inside the record-production row made full-width on mobile**
- `تاریخ تولید` wrapper: `<div>` → `<div className="w-full">`
- `محصول تولید شده` wrapper: `<div>` → `<div className="w-full">`
- `مقدار تولید (kg)` wrapper: `<div>` → `<div className="w-full">`
- Verified by re-read: all three `<div className="w-full">` present under the row; Persian labels intact. (`ثبت تولید` button left as-is.)

**11c. Formula row**
- OLD: `className="flex items-end gap-2 p-2 border-t"`
- NEW: `className="flex flex-col md:flex-row md:items-end gap-2 p-2 border-t"`
- Verified by re-read: new string present (n=1); old string gone (n=0).

**11d. Inline max-width replaced with responsive class**
- OLD: `<div style={{maxWidth: '200px'}}>`
- NEW: `<div className="w-full md:w-[200px] md:min-w-[200px]">`
- Verified by re-read: new class present (n=1); `style={{maxWidth:` no longer present (n=0); label `مقدار برای ۱ تن تولید (kg)` intact.

---

## Remaining / uncertain

1. **2FA input/buttons "py-1 → py-2 min-h-[40px]" wording.** The only element in SettingsPage actually using `py-1` was the backups Restore button, which was changed exactly as instructed. The 2FA code input and its two buttons already used `p-2` / `py-2`, so no `py-1` existed to replace; I added `min-h-[40px]` to the code input and both buttons to satisfy the tap-target intent. If a literal `py-1` swap was intended elsewhere, it does not exist in this file.

2. **Formula row inner `flex-1` field.** In `ProductionPage` the formula row's first child remains `<div className="flex-1">` (not wrapped with `w-full`), matching the instruction to change only the row className. On mobile (`flex-col`) that child will still stretch horizontally due to default `align-items: stretch`, so it should be fine, but flagging for completeness.

3. **`ReportsPage` grouped-results `overflow-hidden` removal** also applies to the sibling summary block styling (`bg-slate-100 p-3`); no other clipping ancestors were present, so the grouped tables should now scroll horizontally inside the page's `overflow-x-auto` container.

4. No other instance of `components/MainLayout.tsx` or `components/Sidebar.tsx` was read or modified (per instructions).

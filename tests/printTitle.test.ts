import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

// Regression test for the reported bug: "the custom page title only appears on صفحه اول".
// Root cause was in utils/print.tsx: each printed page looked up only ITS OWN pageSettings entry,
// so pages 2..n fell back to the Settings title and the custom title "disappeared".
//
// window is stubbed before the module is imported because print.tsx reads settings/farmers from
// the local cache through services/dataService.
const store = new Map<string, string>();
(globalThis as any).window = {
    localStorage: {
        getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
        setItem: (k: string, v: string) => { store.set(k, String(v)); },
        removeItem: (k: string) => { store.delete(k); },
    },
    dispatchEvent: () => true,
    addEventListener: () => { /* noop */ },
    removeEventListener: () => { /* noop */ },
};

const MASTER_TITLE = 'عنوان اختصاصی تست';

const renderPage = async (pageNumber: number, totalPages: number) => {
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { PrintRemittanceLayout } = await import('../utils/print');

    const totals: any = { billWeight: 0, scaleWeight: 0, wastage: 0, transportCost: 0 };
    const options: any = {
        pageSettings: [{ title: MASTER_TITLE, description: '' }],
        printDate: new Date(2026, 8, 25),
        showPageTotals: false,
        showGrandTotal: true,
    };

    return renderToStaticMarkup(React.createElement(PrintRemittanceLayout as any, {
        type: 'entry',
        data: [],
        printDate: new Date(2026, 8, 25),
        isMultiPage: totalPages > 1,
        pageNumber,
        totalPages,
        isLastPage: pageNumber === totalPages,
        rowIndexOffset: 0,
        totals,
        pageTotals: totals,
        options,
    } as any));
};

test('a custom page-1 title is printed on EVERY page, not only the first one', async () => {
    for (const pageNumber of [1, 2, 3]) {
        const html = await renderPage(pageNumber, 3);
        assert.ok(
            html.includes(MASTER_TITLE),
            `page ${pageNumber} must print the master title (previously pages 2+ lost it)`
        );
    }
});

test('a page-specific override still wins over the master title', async () => {
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { PrintRemittanceLayout } = await import('../utils/print');

    const totals: any = { billWeight: 0, scaleWeight: 0, wastage: 0, transportCost: 0 };
    const html = renderToStaticMarkup(React.createElement(PrintRemittanceLayout as any, {
        type: 'entry',
        data: [],
        printDate: new Date(2026, 8, 25),
        isMultiPage: true,
        pageNumber: 2,
        totalPages: 2,
        isLastPage: true,
        rowIndexOffset: 0,
        totals,
        pageTotals: totals,
        options: {
            pageSettings: [{ title: MASTER_TITLE, description: '' }, { title: 'عنوان صفحه دوم', description: '' }],
            printDate: new Date(2026, 8, 25),
            showPageTotals: false,
            showGrandTotal: true,
        },
    } as any));

    assert.ok(html.includes('عنوان صفحه دوم'), 'its own title still applies to that page');
});

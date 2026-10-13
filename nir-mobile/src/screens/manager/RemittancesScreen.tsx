import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PersianDatePickerModal } from '../../components/common/PersianDatePickerModal';
import { apiClient } from '../../api/client';
import { Endpoints } from '../../api/endpoints';
import { extractApiErrorMessage } from '../../api/errors';
import { formatWeight, toPersianDigits } from '../../utils/formatters';
import {
  DEFAULT_PAGE_SIZE,
  RANGE_PRESET_LABELS,
  WEIGH_STATE_LABELS,
  buildInvoiceQuery,
  counterpartyLabel,
  displayWeightKg,
  normalizeInvoicesPage,
  pageSummary,
  partyName,
  productLabel,
  quickRange,
  rangeLabel,
  remittanceLabel,
  weighStateOf,
  type InvoiceRow,
  type InvoicesPage,
  type RangePreset,
  type RemittanceTab,
} from '../../features/manager/remittanceList';

const SEARCH_DEBOUNCE_MS = 450;
const TAB_LABELS: Record<RemittanceTab, string> = { exit: 'خروجی', entry: 'ورودی' };
const PRESETS: RangePreset[] = ['today', 'last7', 'last30'];

function TabSelector({
  value,
  counts,
  onChange,
}: {
  value: RemittanceTab;
  counts: { exit: number; entry: number } | null;
  onChange: (next: RemittanceTab) => void;
}) {
  return (
    <View style={styles.tabRow}>
      {(['exit', 'entry'] as RemittanceTab[]).map((t) => {
        const active = t === value;
        const count = counts ? counts[t] : null;
        return (
          <TouchableOpacity
            key={t}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(t)}
            accessibilityRole="button"
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{TAB_LABELS[t]}</Text>
            <Text style={[styles.tabCount, active && styles.tabTextActive]}>
              {count === null ? 'در حال شمارش...' : `${toPersianDigits(count)} حواله`}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function DateRangeBar({
  startDate,
  endDate,
  onPickStart,
  onPickEnd,
  onPreset,
  onClear,
}: {
  startDate: string | null;
  endDate: string | null;
  onPickStart: () => void;
  onPickEnd: () => void;
  onPreset: (preset: RangePreset) => void;
  onClear: () => void;
}) {
  const hasRange = Boolean(startDate || endDate);
  return (
    <View style={styles.rangeBox}>
      <View style={styles.rangeRow}>
        <TouchableOpacity style={styles.rangeBtn} onPress={onPickStart}>
          <Text style={styles.rangeBtnLabel}>از تاریخ</Text>
          <Text style={styles.rangeBtnValue}>
            {startDate ? toPersianDigits(startDate) : 'انتخاب'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.rangeBtn} onPress={onPickEnd}>
          <Text style={styles.rangeBtnLabel}>تا تاریخ</Text>
          <Text style={styles.rangeBtnValue}>{endDate ? toPersianDigits(endDate) : 'انتخاب'}</Text>
        </TouchableOpacity>
        {hasRange ? (
          <TouchableOpacity style={styles.clearBtn} onPress={onClear}>
            <Text style={styles.clearBtnText}>پاک کردن</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.presetRow}>
        {PRESETS.map((preset) => (
          <TouchableOpacity
            key={preset}
            style={styles.presetBtn}
            onPress={() => onPreset(preset)}
          >
            <Text style={styles.presetText}>{RANGE_PRESET_LABELS[preset]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.rangeHint}>{rangeLabel(startDate, endDate)}</Text>
    </View>
  );
}

function RemittanceCard({ row }: { row: InvoiceRow }) {
  const weighState = weighStateOf(row);
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <StatusBadge
          status={weighState === 'weighed' ? 'success' : 'pending'}
          label={WEIGH_STATE_LABELS[weighState]}
          size="sm"
        />
        <View style={styles.invoiceBox}>
          <Text style={styles.invoiceLabel}>حواله:</Text>
          <Text style={styles.invoiceValue}>{toPersianDigits(remittanceLabel(row))}</Text>
          <Text style={styles.dateText}>
            {row.date ? toPersianDigits(String(row.date)) : 'بدون تاریخ'}
          </Text>
        </View>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>{counterpartyLabel(row)}:</Text>
        <Text style={styles.infoValue}>{partyName(row)}</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>کالا:</Text>
        <Text style={styles.infoValue}>{productLabel(row)}</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>راننده:</Text>
        <Text style={styles.infoValue}>
          {row.driverName || 'ثبت نشده'}
          {row.driverPhone ? ` (${toPersianDigits(row.driverPhone)})` : ''}
        </Text>
      </View>

      <View style={styles.weightRow}>
        <View style={styles.weightBox}>
          <Text style={styles.weightLabel}>وزن بارنامه</Text>
          <Text style={styles.weightValue}>
            {formatWeight(Number(row.billWeight ?? 0) || 0, false)}
          </Text>
        </View>
        <View style={styles.weightBox}>
          <Text style={styles.weightLabel}>وزن باسکول</Text>
          <Text style={[styles.weightValue, styles.weightScale]}>
            {Number(row.scaleWeight ?? 0) > 0
              ? formatWeight(Number(row.scaleWeight), false)
              : 'توزین نشده'}
          </Text>
        </View>
        <View style={styles.weightBox}>
          <Text style={styles.weightLabel}>وزن مرجع</Text>
          <Text style={styles.weightValue}>{formatWeight(displayWeightKg(row), false)}</Text>
        </View>
      </View>
    </View>
  );
}

function Pager({
  page,
  totalPages,
  busy,
  onPrev,
  onNext,
}: {
  page: number;
  totalPages: number;
  busy: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.pager}>
      <TouchableOpacity
        style={[styles.pagerBtn, (page <= 1 || busy) && styles.pagerBtnDisabled]}
        disabled={page <= 1 || busy}
        onPress={onPrev}
      >
        <Text style={styles.pagerBtnText}>صفحه قبل</Text>
      </TouchableOpacity>
      <Text style={styles.pagerLabel}>
        صفحه {toPersianDigits(page)} از {toPersianDigits(totalPages)}
      </Text>
      <TouchableOpacity
        style={[styles.pagerBtn, (page >= totalPages || busy) && styles.pagerBtnDisabled]}
        disabled={page >= totalPages || busy}
        onPress={onNext}
      >
        <Text style={styles.pagerBtnText}>صفحه بعد</Text>
      </TouchableOpacity>
    </View>
  );
}

export function RemittancesScreen() {
  const [tab, setTab] = useState<RemittanceTab>('exit');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);

  // Typing must not fire one request per keystroke; the query key only changes when this settles.
  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Every filter change restarts the list at page 1 (staying on page 7 of a new filter shows nothing).
  useEffect(() => {
    setPage(1);
  }, [tab, search, startDate, endDate]);

  const listQuery = useQuery({
    queryKey: ['manager', 'remittances', tab, search, startDate, endDate, page],
    queryFn: async () => {
      const res = await apiClient.get(Endpoints.web.invoices, {
        params: buildInvoiceQuery({
          tab,
          search,
          startDate,
          endDate,
          page,
          pageSize: DEFAULT_PAGE_SIZE,
        }),
      });
      return normalizeInvoicesPage(res.data, DEFAULT_PAGE_SIZE);
    },
    placeholderData: (previous: InvoicesPage | undefined) => previous,
  });

  // Two one-row requests give both tab counters from the server, so neither tab shows a guessed number.
  const countsQuery = useQuery({
    queryKey: ['manager', 'remittances', 'counts', startDate, endDate],
    queryFn: async () => {
      const [exitRes, entryRes] = await Promise.all([
        apiClient.get(Endpoints.web.invoices, {
          params: buildInvoiceQuery({ tab: 'exit', startDate, endDate, page: 1, pageSize: 1 }),
        }),
        apiClient.get(Endpoints.web.invoices, {
          params: buildInvoiceQuery({ tab: 'entry', startDate, endDate, page: 1, pageSize: 1 }),
        }),
      ]);
      return {
        exit: Number(exitRes.data?.total) || 0,
        entry: Number(entryRes.data?.total) || 0,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const pageData = listQuery.data;
  const rows = useMemo<InvoiceRow[]>(() => pageData?.rows ?? [], [pageData]);
  const errorText = listQuery.isError
    ? extractApiErrorMessage(listQuery.error, 'دریافت فهرست حواله‌ها ناموفق بود.')
    : null;

  const applyPreset = (preset: RangePreset) => {
    const range = quickRange(preset);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  };

  return (
    <ScreenContainer
      scrollable={false}
      title="حواله‌ها"
      subtitle="فهرست خروجی و ورودی کارخانه — با فیلتر و صفحه‌بندی سروری"
    >
      <FlatList
        data={rows}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <RemittanceCard row={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={listQuery.isFetching && !listQuery.isLoading}
            onRefresh={() => {
              listQuery.refetch();
              countsQuery.refetch();
            }}
            colors={['#0284c7']}
          />
        }
        ListHeaderComponent={
          <View>
            <TabSelector value={tab} counts={countsQuery.data ?? null} onChange={setTab} />

            <TextInput
              style={styles.searchInput}
              placeholder="جست‌وجو: شماره حواله، راننده، کالا، مبدأ یا توضیحات"
              placeholderTextColor="#94a3b8"
              value={searchInput}
              onChangeText={setSearchInput}
              textAlign="right"
              returnKeyType="search"
            />

            <DateRangeBar
              startDate={startDate}
              endDate={endDate}
              onPickStart={() => setPicker('start')}
              onPickEnd={() => setPicker('end')}
              onPreset={applyPreset}
              onClear={() => {
                setStartDate(null);
                setEndDate(null);
              }}
            />

            <Text style={styles.note}>
              ثبت حواله جدید طبق روال کارخانه از پنل وب انجام می‌شود؛ این صفحه فقط برای مشاهده و پایش
              است.
            </Text>

            {errorText ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorText}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          listQuery.isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#0284c7" />
              <Text style={styles.loadingText}>در حال دریافت حواله‌ها از سرور...</Text>
            </View>
          ) : errorText ? null : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                {tab === 'exit'
                  ? 'حواله خروجی با این فیلترها پیدا نشد.'
                  : 'حواله ورودی با این فیلترها پیدا نشد.'}
              </Text>
              <Text style={styles.emptyHint}>
                بازه تاریخ یا عبارت جست‌وجو را تغییر دهید؛ خالی بودن نتیجه یعنی سرور برای این فیلتر ردیفی
                برنگردانده است.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          rows.length > 0 && pageData ? (
            <View>
              <Text style={styles.summaryLine}>{toPersianDigits(pageSummary(pageData))}</Text>
              <Pager
                page={pageData.page}
                totalPages={pageData.totalPages}
                busy={listQuery.isFetching}
                onPrev={() => setPage((current) => Math.max(1, current - 1))}
                onNext={() => setPage((current) => current + 1)}
              />
            </View>
          ) : null
        }
      />

      <PersianDatePickerModal
        key={picker ?? 'closed'}
        visible={picker !== null}
        initialDate={(picker === 'start' ? startDate : endDate) ?? undefined}
        onClose={() => setPicker(null)}
        onSelect={(value) => {
          if (picker === 'start') setStartDate(value);
          else setEndDate(value);
        }}
      />
    </ScreenContainer>
  );
}



const styles = StyleSheet.create({
  listContent: {
    padding: 14,
    paddingBottom: 28,
    gap: 10,
  },
  tabRow: {
    flexDirection: 'row-reverse',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 4,
    gap: 4,
    marginBottom: 10,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#0284c7',
  },
  tabText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#334155',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  tabCount: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  searchInput: {
    fontFamily: 'Vazirmatn_400Regular',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0f172a',
    marginBottom: 10,
  },
  rangeBox: {
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    marginBottom: 10,
  },
  rangeRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    alignItems: 'stretch',
  },
  rangeBtn: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingVertical: 7,
    alignItems: 'center',
  },
  rangeBtnLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#64748b',
  },
  rangeBtnValue: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#0f172a',
    marginTop: 2,
  },
  clearBtn: {
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#fee2e2',
  },
  clearBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
    color: '#b91c1c',
  },
  presetRow: {
    flexDirection: 'row-reverse',
    gap: 6,
    marginTop: 8,
  },
  presetBtn: {
    flex: 1,
    backgroundColor: '#e0f2fe',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  presetText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
    color: '#0369a1',
  },
  rangeHint: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#475569',
    textAlign: 'right',
    marginTop: 8,
  },
  note: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    textAlign: 'right',
    lineHeight: 18,
    marginBottom: 10,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  errorText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#b91c1c',
    textAlign: 'right',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 8,
    marginBottom: 8,
  },
  invoiceBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  invoiceLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
  },
  invoiceValue: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
  },
  dateText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#94a3b8',
  },
  infoRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 3,
  },
  infoLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
  },
  infoValue: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#1e293b',
    flexShrink: 1,
    textAlign: 'right',
  },
  weightRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
  },
  weightBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  weightLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#64748b',
  },
  weightValue: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 12,
    color: '#334155',
    marginTop: 2,
  },
  weightScale: {
    color: '#0284c7',
  },
  pager: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 8,
    marginTop: 6,
  },
  pagerBtn: {
    backgroundColor: '#e0f2fe',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pagerBtnDisabled: {
    backgroundColor: '#f1f5f9',
  },
  pagerBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#0369a1',
  },
  pagerLabel: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#334155',
  },
  summaryLine: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 8,
  },
  loadingBox: {
    padding: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#64748b',
    marginTop: 8,
  },
  emptyBox: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
  },
  emptyHint: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
});

export default RemittancesScreen;


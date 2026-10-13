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
import { apiClient } from '../../api/client';
import { Endpoints } from '../../api/endpoints';
import { extractApiErrorMessage } from '../../api/errors';
import { toPersianDigits } from '../../utils/formatters';
import {
  DEFAULT_UNMATCHED_LIMIT,
  UNMATCHED_TYPE_HINTS,
  UNMATCHED_TYPE_LABELS,
  buildUnmatchedQuery,
  groupBreakdown,
  groupDateRange,
  isStrongSuggestion,
  normalizeUnmatchedPage,
  scanCoverageNote,
  suggestionLabel,
  suggestionTone,
  type UnmatchedGroup,
  type UnmatchedPage,
  type UnmatchedType,
} from '../../features/manager/unmatchedDrivers';

const SEARCH_DEBOUNCE_MS = 450;
const TYPES: UnmatchedType[] = ['all', 'exit', 'entry'];

function TypeSelector({
  value,
  onChange,
}: {
  value: UnmatchedType;
  onChange: (next: UnmatchedType) => void;
}) {
  return (
    <View style={styles.tabRow}>
      {TYPES.map((t) => {
        const active = t === value;
        return (
          <TouchableOpacity
            key={t}
            style={[styles.tab, active && styles.tabActive]}
            onPress={() => onChange(t)}
            accessibilityRole="button"
          >
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {UNMATCHED_TYPE_LABELS[t]}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function ReportSummary({ page }: { page: UnmatchedPage }) {
  const note = scanCoverageNote(page);
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryTitle}>
        راننده‌هایی که حواله دارند اما به پرونده راننده وصل نیستند
      </Text>
      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>گروه نام</Text>
          <Text style={styles.summaryVal}>{toPersianDigits(page.totalGroups)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>حواله بی‌ارتباط</Text>
          <Text style={styles.summaryVal}>{toPersianDigits(page.totalInvoices)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>راننده ثبت‌شده</Text>
          <Text style={styles.summaryVal}>{toPersianDigits(page.driversIndexed)}</Text>
        </View>
      </View>
      {note ? <Text style={styles.summaryNote}>{note}</Text> : null}
      <Text style={styles.summaryNote}>
        این گزارش فقط خواندنی است: برای هر گروه بهترین گزینه را پیشنهاد می‌دهد اما اتصال را ذخیره
        نمی‌کند — اصلاح پروندهٔ راننده باید عمدی و با تایید شما انجام شود.
      </Text>
    </View>
  );
}

function GroupCard({ group }: { group: UnmatchedGroup }) {
  const reason = group.suggestionReason;
  const tone = suggestionTone(reason);
  const strong = isStrongSuggestion(reason);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <StatusBadge status={tone} label={strong ? 'پیشنهاد مستند' : 'نیازمند بررسی'} size="sm" />
        <Text style={styles.driverName}>{group.driverName}</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>تعداد:</Text>
        <Text style={styles.infoValue}>{toPersianDigits(groupBreakdown(group))}</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>بازه تاریخ:</Text>
        <Text style={styles.infoValue}>{toPersianDigits(groupDateRange(group))}</Text>
      </View>

      {group.phones.length > 0 && (
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>شماره روی حواله:</Text>
          <Text style={styles.infoValue}>{toPersianDigits(group.phones.join(' ، '))}</Text>
        </View>
      )}

      {group.sampleInvoices.length > 0 && (
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>نمونه حواله:</Text>
          <Text style={styles.infoValue}>
            {toPersianDigits(group.sampleInvoices.slice(0, 4).join(' ، '))}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.suggestionBox,
          tone === 'success'
            ? styles.suggestionGood
            : tone === 'warning'
            ? styles.suggestionWarn
            : styles.suggestionInfo,
        ]}
      >
        <Text style={styles.suggestionTitle}>
          {group.suggestedDriverName ? `پیشنهاد: ${group.suggestedDriverName}` : 'پیشنهادی ثبت نشده'}
        </Text>
        <Text style={styles.suggestionReason}>{suggestionLabel(reason)}</Text>
      </View>

      <View style={styles.lockedBtn}>
        <Text style={styles.lockedBtnText}>اتصال پرونده راننده در گام بعدی فعال می‌شود</Text>
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

export function UnmatchedDriversScreen({ navigation }: any) {
  const [type, setType] = useState<UnmatchedType>('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [type, search]);

  const reportQuery = useQuery({
    queryKey: ['manager', 'unmatched-drivers', type, search, page],
    queryFn: async () => {
      const res = await apiClient.get(Endpoints.manager.unmatchedDrivers, {
        params: buildUnmatchedQuery({
          type,
          search,
          page,
          limit: DEFAULT_UNMATCHED_LIMIT,
        }),
      });
      return normalizeUnmatchedPage(res.data);
    },
    placeholderData: (previous: UnmatchedPage | undefined) => previous,
  });

  const report = reportQuery.data;
  const groups = useMemo<UnmatchedGroup[]>(() => report?.groups ?? [], [report]);
  const errorText = reportQuery.isError
    ? extractApiErrorMessage(reportQuery.error, 'دریافت گزارش راننده‌های نامطابق ناموفق بود.')
    : null;

  return (
    <ScreenContainer
      scrollable={false}
      showBack
      onBack={() => navigation?.goBack?.()}
      title="راننده‌های نامطابق"
      subtitle="حواله‌هایی که نام راننده دارند اما به پرونده راننده وصل نشده‌اند"
    >
      <FlatList
        data={groups}
        keyExtractor={(item) => item.nameKey || item.driverName}
        renderItem={({ item }) => <GroupCard group={item} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={reportQuery.isFetching && !reportQuery.isLoading}
            onRefresh={() => reportQuery.refetch()}
            colors={['#0284c7']}
          />
        }
        ListHeaderComponent={
          <View>
            <TypeSelector value={type} onChange={setType} />
            <Text style={styles.typeHint}>{UNMATCHED_TYPE_HINTS[type]}</Text>

            <TextInput
              style={styles.searchInput}
              placeholder="جست‌وجوی نام راننده در این گزارش"
              placeholderTextColor="#94a3b8"
              value={searchInput}
              onChangeText={setSearchInput}
              textAlign="right"
              returnKeyType="search"
            />

            {report ? <ReportSummary page={report} /> : null}

            {errorText ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorText}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          reportQuery.isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#0284c7" />
              <Text style={styles.loadingText}>در حال بررسی حواله‌ها روی سرور...</Text>
            </View>
          ) : errorText ? null : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>در این فیلتر، حواله‌ای با راننده نامطابق پیدا نشد.</Text>
              <Text style={styles.emptyHint}>
                یعنی همه راننده‌های این بازه به پروندهٔ خودشان وصل هستند.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          groups.length > 0 && report ? (
            <View>
              <Text style={styles.summaryLine}>
                {toPersianDigits(`${groups.length} از ${report.totalGroups} گروه`)}
              </Text>
              <Pager
                page={report.page}
                totalPages={report.totalPages}
                busy={reportQuery.isFetching}
                onPrev={() => setPage((current) => Math.max(1, current - 1))}
                onNext={() => setPage((current) => current + 1)}
              />
            </View>
          ) : null
        }
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
  typeHint: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 6,
    marginBottom: 10,
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
  summaryCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  summaryTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#ffffff',
    textAlign: 'right',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#94a3b8',
    marginBottom: 4,
  },
  summaryVal: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 16,
    color: '#38bdf8',
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#334155',
  },
  summaryNote: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#cbd5e1',
    textAlign: 'right',
    lineHeight: 17,
    marginTop: 10,
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
  driverName: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
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
  suggestionBox: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginTop: 10,
  },
  suggestionGood: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  suggestionWarn: {
    backgroundColor: '#fffbeb',
    borderColor: '#fde68a',
  },
  suggestionInfo: {
    backgroundColor: '#f8fafc',
    borderColor: '#e2e8f0',
  },
  suggestionTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 12,
    color: '#0f172a',
    textAlign: 'right',
  },
  suggestionReason: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#475569',
    textAlign: 'right',
    marginTop: 4,
    lineHeight: 17,
  },
  lockedBtn: {
    marginTop: 10,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  lockedBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
    color: '#64748b',
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

export default UnmatchedDriversScreen;







import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { apiClient } from '../../api/client';
import { Endpoints } from '../../api/endpoints';
import { extractApiErrorMessage } from '../../api/errors';
import { formatWeight, toPersianDigits } from '../../utils/formatters';
import {
  INVENTORY_FILTER_LABELS,
  STOCK_TONE_LABELS,
  filterInventory,
  inventoryTypeLabel,
  minStockLabel,
  normalizeInventoryItems,
  stockBarPercent,
  stockTone,
  summarizeInventory,
  type InventoryFilter,
  type InventoryItem,
  type InventorySummary,
} from '../../features/manager/inventoryView';

const FILTERS: InventoryFilter[] = ['all', 'raw', 'finished', 'attention'];

const TONE_VARIANT: Record<string, string> = { ok: 'success', low: 'warning', out: 'error' };

function SummaryCard({ summary }: { summary: InventorySummary }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryTitle}>موجودی زنده اقلام (بر پایه سامانه انبارداری)</Text>
      <View style={styles.summaryRow}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>اقلام فعال</Text>
          <Text style={styles.summaryVal}>{toPersianDigits(summary.totalItems)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>کل موجودی</Text>
          <Text style={styles.summaryVal}>{formatWeight(summary.totalStockKg, false)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>کم‌موجود</Text>
          <Text style={[styles.summaryVal, styles.summaryWarn]}>
            {toPersianDigits(summary.lowCount)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryLabel}>ناموجود</Text>
          <Text style={[styles.summaryVal, styles.summaryDanger]}>
            {toPersianDigits(summary.outCount)}
          </Text>
        </View>
      </View>
      <Text style={styles.summaryNote}>
        اعداد از ستون «موجودی فعلی» اقلام کالا خوانده می‌شود؛ رشد یا کاهش آن با هر تراکنش انبار در سرور
        به‌روز می‌شود.
      </Text>
    </View>
  );
}

function ItemCard({ item, maxStockKg }: { item: InventoryItem; maxStockKg: number }) {
  const tone = stockTone(item);
  const percent = stockBarPercent(item, maxStockKg);

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <StatusBadge status={TONE_VARIANT[tone]} label={STOCK_TONE_LABELS[tone]} size="sm" />
        <Text style={styles.itemName}>{item.name}</Text>
      </View>

      <Text style={styles.itemType}>{inventoryTypeLabel(item.type)}</Text>

      <View style={styles.progressContainer}>
        <View
          style={[
            styles.progressBar,
            { width: `${percent}%` },
            tone === 'low' && styles.progressBarWarn,
            tone === 'out' && styles.progressBarOut,
          ]}
        />
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>موجودی فعلی</Text>
          <Text style={[styles.statVal, styles.stockVal]}>{formatWeight(item.currentStock)}</Text>
        </View>
        <View style={styles.statBox}>
          <Text style={styles.statLabel}>حد بحرانی</Text>
          <Text style={styles.statVal}>
            {item.minStock === null ? 'تعیین نشده' : formatWeight(item.minStock)}
          </Text>
        </View>
      </View>

      <Text style={styles.itemHint}>{minStockLabel(item)}</Text>
    </View>
  );
}

export function InventoryMonitorScreen() {
  const [filter, setFilter] = useState<InventoryFilter>('all');

  // Same query key as the KPI tab on purpose: react-query then shares one request for both screens.
  const inventoryQuery = useQuery({
    queryKey: ['manager', 'kpi'],
    queryFn: async () => {
      const res = await apiClient.get(Endpoints.manager.kpi);
      return res.data;
    },
  });

  const items = useMemo<InventoryItem[]>(
    () => normalizeInventoryItems(inventoryQuery.data?.inventory),
    [inventoryQuery.data]
  );
  const summary = useMemo<InventorySummary>(() => summarizeInventory(items), [items]);
  const visible = useMemo<InventoryItem[]>(() => filterInventory(items, filter), [items, filter]);

  const errorText = inventoryQuery.isError
    ? extractApiErrorMessage(inventoryQuery.error, 'دریافت موجودی انبار ناموفق بود.')
    : null;

  return (
    <ScreenContainer
      scrollable={false}
      title="انبار و سیلو"
      subtitle="موجودی زنده مواد اولیه و خوراک آماده کارخانه"
    >
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <ItemCard item={item} maxStockKg={summary.maxStockKg} />}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={inventoryQuery.isFetching && !inventoryQuery.isLoading}
            onRefresh={() => inventoryQuery.refetch()}
            colors={['#0284c7']}
          />
        }
        ListHeaderComponent={
          <View>
            <SummaryCard summary={summary} />

            <View style={styles.filterRow}>
              {FILTERS.map((f) => {
                const active = f === filter;
                const count = filterInventory(items, f).length;
                return (
                  <TouchableOpacity
                    key={f}
                    style={[styles.filterBtn, active && styles.filterBtnActive]}
                    onPress={() => setFilter(f)}
                  >
                    <Text style={[styles.filterText, active && styles.filterTextActive]}>
                      {INVENTORY_FILTER_LABELS[f]}
                    </Text>
                    <Text style={[styles.filterCount, active && styles.filterTextActive]}>
                      {toPersianDigits(count)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {errorText ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorText}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          inventoryQuery.isLoading ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#0284c7" />
              <Text style={styles.loadingText}>در حال دریافت موجودی از سرور...</Text>
            </View>
          ) : errorText ? null : (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>
                {items.length === 0
                  ? 'هیچ قلم کالای فعالی روی سرور ثبت نشده است.'
                  : 'با این فیلتر قلمی برای نمایش نیست.'}
              </Text>
              <Text style={styles.emptyHint}>
                این فهرست فقط اقلام واقعی ثبت‌شده را نشان می‌دهد؛ اگر انتظار قلمی را دارید که اینجا نیست،
                ابتدا باید در سامانه تعریف و فعال شود.
              </Text>
            </View>
          )
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
  summaryCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 14,
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
    fontSize: 14,
    color: '#38bdf8',
  },
  summaryWarn: {
    color: '#fbbf24',
  },
  summaryDanger: {
    color: '#f87171',
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
    marginTop: 12,
  },
  filterRow: {
    flexDirection: 'row-reverse',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  filterBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 8,
  },
  filterBtnActive: {
    backgroundColor: '#0284c7',
  },
  filterText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
    color: '#334155',
    textAlign: 'center',
  },
  filterTextActive: {
    color: '#ffffff',
  },
  filterCount: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
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
    marginBottom: 6,
  },
  itemName: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
    flexShrink: 1,
    textAlign: 'right',
  },
  itemType: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    textAlign: 'right',
    marginBottom: 10,
  },
  progressContainer: {
    height: 10,
    backgroundColor: '#f1f5f9',
    borderRadius: 5,
    overflow: 'hidden',
    marginBottom: 12,
    flexDirection: 'row-reverse',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#0284c7',
    borderRadius: 5,
  },
  progressBarWarn: {
    backgroundColor: '#f59e0b',
  },
  progressBarOut: {
    backgroundColor: '#ef4444',
  },
  statsRow: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  statLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#64748b',
    marginBottom: 2,
  },
  statVal: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 12,
    color: '#334155',
  },
  stockVal: {
    color: '#0284c7',
  },
  itemHint: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#94a3b8',
    textAlign: 'right',
    marginTop: 8,
  },
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 10,
    marginTop: 10,
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

export default InventoryMonitorScreen;





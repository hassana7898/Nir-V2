import React from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { apiClient } from '../../api/client';
import { formatWeight, toPersianDigits } from '../../utils/formatters';

export function InventoryMonitorScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager', 'inventory-monitor'],
    queryFn: async () => {
      const res = await apiClient.get('/api/warehouses');
      return (res.data?.data || []) as any[];
    },
  });

  const warehouses = data || [];

  const totalCapacityKg = warehouses.reduce((sum: number, w: any) => sum + (w.capacityKg || 0), 0);
  const totalStockKg = warehouses.reduce((sum: number, w: any) => sum + (w.currentStockKg || 0), 0);
  const overallPercent = totalCapacityKg > 0 ? ((totalStockKg / totalCapacityKg) * 100).toFixed(1) : '0';

  const renderItem = ({ item }: { item: any }) => {
    const percent = Math.min(100, Math.max(0, item.percent || 0));
    const isWarning = percent < 30 || percent > 90;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={[styles.badge, isWarning ? styles.badgeWarning : styles.badgeNormal]}>
            <Text style={[styles.badgeText, isWarning ? styles.badgeTextWarning : styles.badgeTextNormal]}>
              {percent.toFixed(0)}٪ پر شده
            </Text>
          </View>
          <Text style={styles.warehouseName}>{item.name}</Text>
        </View>

        <Text style={styles.productName}>محتوا: {item.productName || 'موجودیت نامشخص'}</Text>

        {/* Progress Bar */}
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${percent}%` }, isWarning && styles.progressBarWarn]} />
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>ظرفیت اسمی سیلو</Text>
            <Text style={styles.statVal}>{formatWeight(item.capacityKg || 0)}</Text>
          </View>

          <View style={styles.statBox}>
            <Text style={styles.statLabel}>موجودی فعلی</Text>
            <Text style={[styles.statVal, styles.stockVal]}>{formatWeight(item.currentStockKg || 0)}</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer title="پایش سیلوها و انبارها" subtitle="موجودی لحظه‌ای مواد اولیه و خوراک آماده پلت">
      {/* Executive Summary Card */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>وضعیت کل ذخایر کارخانه خوراک آرادان</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>کل موجودی فیزیکی</Text>
            <Text style={styles.summaryVal}>{formatWeight(totalStockKg)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>کل ظرفیت ذخیره‌سازی</Text>
            <Text style={styles.summaryVal}>{formatWeight(totalCapacityKg)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>ضریب اشغال کل</Text>
            <Text style={[styles.summaryVal, styles.percentVal]}>{toPersianDigits(overallPercent)}٪</Text>
          </View>
        </View>
      </View>

      {/* Warehouses list */}
      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>در حال دریافت موجودی انبارها...</Text>
        </View>
      ) : (
        <FlatList
          data={warehouses}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>اطلاعات انباری یافت نشد.</Text>
            </View>
          }
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    backgroundColor: '#0f172a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  summaryTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#38bdf8',
    textAlign: 'center',
    marginBottom: 12,
  },
  summaryRow: {
    flexDirection: 'row',
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
    fontSize: 12,
    color: '#ffffff',
  },
  percentVal: {
    color: '#38bdf8',
    fontSize: 14,
  },
  summaryDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#334155',
  },
  listContent: {
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  warehouseName: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  badgeNormal: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  badgeWarning: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
  },
  badgeText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 11,
  },
  badgeTextNormal: {
    color: '#16a34a',
  },
  badgeTextWarning: {
    color: '#d97706',
  },
  productName: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#64748b',
    marginBottom: 10,
    textAlign: 'right',
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
  statsRow: {
    flexDirection: 'row',
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
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 13,
    color: '#94a3b8',
  },
});

export default InventoryMonitorScreen;

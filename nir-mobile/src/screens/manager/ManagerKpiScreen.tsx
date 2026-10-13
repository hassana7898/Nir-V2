import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { MetricCard } from '../../components/common/MetricCard';
import { apiClient } from '../../api/client';
import { Endpoints } from '../../api/endpoints';
import {
  formatWeight,
  toPersianDigits,
} from '../../utils/formatters';

export function ManagerKpiScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager-kpi'],
    queryFn: async () => {
      const res = await apiClient.get(Endpoints.manager.kpi);
      return res.data;
    },
  });

  // Live field names from GET /api/mobile/manager/kpi (server/routes/mobile.ts). The Phase 1 screen read
  // `todayEntryWeight` / `entryTonnage` / `inventorySummary` — names that endpoint has never returned —
  // so every card showed 0 and the inventory block silently fell back to hand-written sample rows.
  const todayJalali = String(data?.todayJalali || '');
  const entryTonnageKg = Number(data?.entryTonnageKg || 0);
  const exitTonnageKg = Number(data?.exitTonnageKg || 0);
  const entryTonnageTon = Number(data?.entryTonnageTon ?? entryTonnageKg / 1000);
  const exitTonnageTon = Number(data?.exitTonnageTon ?? exitTonnageKg / 1000);
  const invoicesCount = Number(data?.todayInvoicesCount || 0);
  const weighbridgeCount = Number(data?.weighbridgeTicketsToday || 0);
  const inventoryItems: any[] = Array.isArray(data?.inventory) ? data.inventory : [];


  return (
    <ScreenContainer
      title="داشبورد پایش کارخانه"
      subtitle={
        todayJalali
          ? `امروز ${toPersianDigits(todayJalali)} — شاخص‌های زنده تولید، انبار و باسکول`
          : 'شاخص‌های زنده تولید، انبار و باسکول'
      }
      onRefresh={refetch}
      refreshing={isRefetching}
    >
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>در حال دریافت شاخص‌های زنده...</Text>
        </View>
      ) : (
        <>
          {/* Main 4 KPI Metrics */}
          <Text style={styles.sectionTitle}>عملکرد و تناژ امروز</Text>

          <View style={styles.kpiGrid}>
            <MetricCard
              title="مجموع ورود امروز"
              value={entryTonnageKg}
              unit="کیلوگرم"
              variant="primary"
              subtitle={`معادل ${toPersianDigits(entryTonnageTon)} تن — نهاده‌های ورودی`}
            />
            <MetricCard
              title="مجموع خروج امروز"
              value={exitTonnageKg}
              unit="کیلوگرم"
              variant="success"
              subtitle={`معادل ${toPersianDigits(exitTonnageTon)} تن — خوراک بارگیری‌شده`}
            />
          </View>

          <View style={styles.kpiGrid}>
            <MetricCard
              title="حواله‌های امروز"
              value={invoicesCount}
              unit="حواله"
              variant="default"
              subtitle="مجموع ورودی و خروجی ثبت‌شده امروز"
            />
            <MetricCard
              title="قبوض باسکول امروز"
              value={weighbridgeCount}
              unit="قبض"
              variant="default"
              subtitle="توزین یا همگام‌سازی‌شده در سرور باسکول"
            />
          </View>

          {/* Warehouse Inventory Section */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>موجودی زنده انبارهای کارخانه</Text>
              <Text style={styles.cardSub}>از ستون «موجودی فعلی» اقلام کالا در سرور</Text>
            </View>

            {inventoryItems.length > 0 ? (
              <View style={styles.inventoryList}>
                {inventoryItems.slice(0, 10).map((item: any, idx: number) => {
                  const stock = Number(item.currentStock || 0);
                  const min =
                    item.minStock === null || item.minStock === undefined
                      ? null
                      : Number(item.minStock);
                  const belowMin = min !== null && stock < min;
                  return (
                    <View key={item.id || idx} style={styles.invRow}>
                      <View style={styles.invNameWrap}>
                        <Text style={styles.invName}>{item.name}</Text>
                        {stock <= 0 ? (
                          <Text style={styles.invWarn}>ناموجود</Text>
                        ) : belowMin ? (
                          <Text style={styles.invWarn}>کمتر از حد بحرانی</Text>
                        ) : null}
                      </View>
                      <Text style={[styles.invStock, stock <= 0 && styles.negativeStock]}>
                        {formatWeight(stock)}
                      </Text>
                    </View>
                  );
                })}
                {inventoryItems.length > 10 ? (
                  <Text style={styles.invMore}>
                    و {toPersianDigits(inventoryItems.length - 10)} قلم دیگر — فهرست کامل در تب «انبار و
                    سیلو»
                  </Text>
                ) : null}
              </View>
            ) : (
              <View style={styles.invEmpty}>
                <Text style={styles.invEmptyText}>
                  هنوز موجودی‌ای برای نمایش ثبت نشده است؛ این بخش از اقلام فعال کالا روی سرور خوانده
                  می‌شود و هیچ ردیف نمونه‌ای نمایش داده نمی‌شود.
                </Text>
              </View>
            )}
          </View>
        </>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  sectionTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#1e293b',
    textAlign: 'right',
    marginBottom: 8,
  },
  kpiGrid: {
    gap: 4,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeader: {
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 8,
    marginBottom: 10,
  },
  cardTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
    textAlign: 'right',
  },
  cardSub: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 2,
  },
  inventoryList: {
    gap: 8,
  },
  sampleInventory: {
    gap: 8,
  },
  invRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#f8fafc',
  },
  invNameWrap: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },
  invWarn: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 10,
    color: '#d97706',
    marginTop: 2,
  },
  invMore: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 8,
  },
  invEmpty: {
    paddingVertical: 12,
  },
  invEmptyText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'right',
    lineHeight: 18,
  },
  invName: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#334155',
  },
  invStock: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#0284c7',
  },
  negativeStock: {
    color: '#dc2626',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 250,
  },
  loadingText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 13,
    color: '#64748b',
    marginTop: 8,
  },
});

export default ManagerKpiScreen;

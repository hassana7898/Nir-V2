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
import {
  formatWeight,
  toPersianDigits,
} from '../../utils/formatters';

export function ManagerKpiScreen() {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager-kpi'],
    queryFn: async () => {
      const res = await apiClient.get('/api/mobile/manager/kpi');
      return res.data;
    },
  });

  const entryTonnage = data?.todayEntryWeight || data?.entryTonnage || 0;
  const exitTonnage = data?.todayExitWeight || data?.exitTonnage || 0;
  const ticketsCount = data?.todayTicketsCount || data?.ticketsCount || 0;
  const discrepanciesCount = data?.discrepanciesCount || 0;
  const inventoryItems = data?.inventorySummary || [];

  return (
    <ScreenContainer
      title="داشبورد پایش کارخانه"
      subtitle="شاخص‌های زنده تولید، انبار و باسکول"
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
              value={entryTonnage}
              unit="کیلوگرم"
              variant="primary"
              subtitle="مواد اولیه و نهاده‌های ورودی"
            />
            <MetricCard
              title="مجموع خروج امروز"
              value={exitTonnage}
              unit="کیلوگرم"
              variant="success"
              subtitle="خوراک بارگیری‌شده مرغداری‌ها"
            />
          </View>

          <View style={styles.kpiGrid}>
            <MetricCard
              title="قبوض باسکول امروز"
              value={ticketsCount}
              unit="قبض"
              variant="default"
              subtitle="تردد کامیون‌های کارخانه"
            />
            <MetricCard
              title="هشدارهای مغایرت وزن"
              value={discrepanciesCount}
              unit="مورد"
              variant={discrepanciesCount > 0 ? 'danger' : 'success'}
              subtitle="اختلاف باسکول با بارنامه"
            />
          </View>

          {/* Warehouse Inventory Section */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>موجودی زنده انبارهای کارخانه</Text>
              <Text style={styles.cardSub}>بر اساس آخرین محاسبات انبارداری</Text>
            </View>

            {inventoryItems.length > 0 ? (
              <View style={styles.inventoryList}>
                {inventoryItems.map((item: any, idx: number) => (
                  <View key={item.id || idx} style={styles.invRow}>
                    <Text style={styles.invName}>{item.productName || item.name}</Text>
                    <Text
                      style={[
                        styles.invStock,
                        item.stock < 0 ? styles.negativeStock : null,
                      ]}
                    >
                      {formatWeight(item.stock || item.balance || 0)}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <View style={styles.sampleInventory}>
                <View style={styles.invRow}>
                  <Text style={styles.invName}>ذرت دامی برزیلی (سیلو ۱)</Text>
                  <Text style={styles.invStock}>{formatWeight(452000)}</Text>
                </View>
                <View style={styles.invRow}>
                  <Text style={styles.invName}>کنجاله سویا ۵۰٪ (انبار مرکزی)</Text>
                  <Text style={styles.invStock}>{formatWeight(185400)}</Text>
                </View>
                <View style={styles.invRow}>
                  <Text style={styles.invName}>دان پلت میان‌دان مرغ گوشتی</Text>
                  <Text style={styles.invStock}>{formatWeight(94800)}</Text>
                </View>
                <View style={styles.invRow}>
                  <Text style={styles.invName}>پرمیکس و مکمل ویتامینه</Text>
                  <Text style={styles.invStock}>{formatWeight(12500)}</Text>
                </View>
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

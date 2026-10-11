import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { MetricCard } from '../../components/common/MetricCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import { OrderFeedModal } from './OrderFeedModal';
import { apiClient } from '../../api/client';
import {
  formatWeight,
  toPersianDigits,
  formatJalaliDate,
} from '../../utils/formatters';

export function FarmerDashboardScreen({ navigation }: any) {
  const [orderModalVisible, setOrderModalVisible] = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['farmer-dashboard'],
    queryFn: async () => {
      const res = await apiClient.get('/api/mobile/farmer/dashboard');
      return res.data;
    },
  });

  const activePeriod = data?.activePeriod || data?.brood;
  const recentInvoices = data?.recentInvoices || [];
  const latestDelivery = data?.latestDelivery || recentInvoices[0];

  return (
    <ScreenContainer
      title="داشبورد مرغدار"
      onRefresh={refetch}
      refreshing={isRefetching}
      headerRight={
        <TouchableOpacity
          style={styles.orderHeaderBtn}
          onPress={() => setOrderModalVisible(true)}
        >
          <Text style={styles.orderHeaderBtnText}>+ ثبت سفارش</Text>
        </TouchableOpacity>
      }
    >
      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>در حال دریافت اطلاعات مرغداری...</Text>
        </View>
      ) : (
        <>
          {/* Active Brood / Period Card */}
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <StatusBadge status="success" label="دوره پرورشی فعال" />
              <Text style={styles.cardTitle}>
                {activePeriod?.name || 'دوره جاری پرورش'}
              </Text>
            </View>

            <View style={styles.broodInfoGrid}>
              <View style={styles.broodItem}>
                <Text style={styles.broodLabel}>سن گله:</Text>
                <Text style={styles.broodVal}>
                  {activePeriod?.ageDays ? `${toPersianDigits(activePeriod.ageDays)} روز` : 'نامشخص'}
                </Text>
              </View>
              <View style={styles.broodItem}>
                <Text style={styles.broodLabel}>تعداد قطعه جوجه:</Text>
                <Text style={styles.broodVal}>
                  {activePeriod?.flockCount ? `${toPersianDigits(activePeriod.flockCount)} قطعه` : '—'}
                </Text>
              </View>
              <View style={styles.broodItem}>
                <Text style={styles.broodLabel}>تاریخ شروع دوره:</Text>
                <Text style={styles.broodVal}>
                  {formatJalaliDate(activePeriod?.startDate) || '—'}
                </Text>
              </View>
            </View>
          </View>

          {/* Key Metrics */}
          <View style={styles.metricsRow}>
            <MetricCard
              title="مجموع دان تحویل‌شده"
              value={data?.totalFeedDelivered || data?.totalWeight || 0}
              unit="کیلوگرم"
              variant="primary"
              subtitle="در طول دوره پرورشی جاری"
            />
            <MetricCard
              title="تعداد محموله‌های دریافتی"
              value={data?.totalLoadsCount || recentInvoices.length}
              unit="حواله"
              variant="success"
            />
          </View>

          {/* Latest Delivery Preview */}
          {latestDelivery && (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <StatusBadge status="delivered" label="آخرین بارنامه ارسالی" />
                <Text style={styles.subHeading}>
                  {toPersianDigits(latestDelivery.invoiceNumber || latestDelivery.id)}
                </Text>
              </View>

              <View style={styles.deliveryRow}>
                <Text style={styles.deliveryLabel}>نوع خوراک:</Text>
                <Text style={styles.deliveryValue}>{latestDelivery.productName || 'دان پلت'}</Text>
              </View>

              <View style={styles.deliveryRow}>
                <Text style={styles.deliveryLabel}>وزن خالص تحویلی:</Text>
                <Text style={[styles.deliveryValue, styles.weightText]}>
                  {formatWeight(latestDelivery.weight || latestDelivery.netWeight || 0)}
                </Text>
              </View>

              <View style={styles.deliveryRow}>
                <Text style={styles.deliveryLabel}>تاریخ تخلیه:</Text>
                <Text style={styles.deliveryValue}>
                  {formatJalaliDate(latestDelivery.date || latestDelivery.createdAt)}
                </Text>
              </View>
            </View>
          )}

          {/* Quick Action Banner */}
          <TouchableOpacity
            style={styles.actionBanner}
            onPress={() => setOrderModalVisible(true)}
          >
            <View>
              <Text style={styles.bannerTitle}>نیاز به سفارش دان جدید دارید؟</Text>
              <Text style={styles.bannerSubtitle}>
                ثبت سفارش آنلاین جیره و تعیین تاریخ درخواستی تحویل
              </Text>
            </View>
            <View style={styles.bannerBtn}>
              <Text style={styles.bannerBtnText}>ثبت سفارش</Text>
            </View>
          </TouchableOpacity>
        </>
      )}

      <OrderFeedModal
        visible={orderModalVisible}
        onClose={() => setOrderModalVisible(false)}
        onSuccess={() => refetch()}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  orderHeaderBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  orderHeaderBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
    color: '#ffffff',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 8,
  },
  cardTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 16,
    color: '#0f172a',
  },
  subHeading: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#64748b',
  },
  broodInfoGrid: {
    gap: 8,
  },
  broodItem: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  broodLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
  },
  broodVal: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#1e293b',
  },
  metricsRow: {
    gap: 4,
  },
  deliveryRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
  },
  deliveryLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
  },
  deliveryValue: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#1e293b',
  },
  weightText: {
    fontFamily: 'Vazirmatn_700Bold',
    color: '#16a34a',
  },
  actionBanner: {
    backgroundColor: '#0284c7',
    borderRadius: 14,
    padding: 16,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  bannerTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#ffffff',
  },
  bannerSubtitle: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#e0f2fe',
    marginTop: 3,
  },
  bannerBtn: {
    backgroundColor: '#ffffff',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
  },
  bannerBtnText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 12,
    color: '#0284c7',
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
    marginTop: 10,
  },
});

export default FarmerDashboardScreen;

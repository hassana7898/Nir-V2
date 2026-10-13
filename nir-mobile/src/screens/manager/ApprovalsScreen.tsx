import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { apiClient } from '../../api/client';
import { Endpoints } from '../../api/endpoints';
import { formatWeight, toPersianDigits, formatJalaliDate } from '../../utils/formatters';

export function ApprovalsScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<'orders' | 'proofs'>('orders');

  // Query for pending farmer orders
  const {
    data: ordersData,
    isLoading: ordersLoading,
    refetch: refetchOrders,
    isRefetching: isRefetchingOrders,
  } = useQuery({
    queryKey: ['manager-orders'],
    queryFn: async () => {
      const res = await apiClient.get(Endpoints.manager.orders);
      return res.data;
    },
    enabled: activeTab === 'orders',
  });

  // Query for delivery proofs
  const {
    data: proofsData,
    isLoading: proofsLoading,
    refetch: refetchProofs,
    isRefetching: isRefetchingProofs,
  } = useQuery({
    queryKey: ['manager-proofs'],
    queryFn: async () => {
      const res = await apiClient.get(Endpoints.manager.proofs);
      return res.data;
    },
    enabled: activeTab === 'proofs',
  });

  const orders = ordersData?.orders || [];
  const proofs = proofsData?.proofs || [];

  const handleUpdateOrderStatus = async (orderId: number | string, newStatus: 'approved' | 'rejected') => {
    try {
      await apiClient.patch(Endpoints.manager.orderStatus(orderId), { status: newStatus });
      Alert.alert(
        'ثبت تصمیم',
        newStatus === 'approved' ? 'سفارش جیره تایید شد.' : 'سفارش جیره رد شد.'
      );
      refetchOrders();
    } catch (err: any) {
      Alert.alert('خطا', err.response?.data?.message || 'عملیات با خطا مواجه شد.');
    }
  };

  const renderOrderItem = ({ item }: { item: any }) => {
    const isPending = item.status === 'pending';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.farmerName}>{item.farmerName || 'مرغداری البرز'}</Text>
          <StatusBadge status={item.status} />
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>نوع جیره درخواستی:</Text>
          <Text style={styles.value}>{item.productName || 'دان رشد طیور'}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>وزن درخواستی:</Text>
          <Text style={[styles.value, styles.weightVal]}>
            {formatWeight(item.requestedWeight || 0)}
          </Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>تاریخ پیشنهادی تخلیه:</Text>
          <Text style={styles.value}>{toPersianDigits(item.targetDate || '—')}</Text>
        </View>

        {item.notes && (
          <View style={styles.notesBox}>
            <Text style={styles.notesLabel}>یادداشت مرغدار:</Text>
            <Text style={styles.notesVal}>{item.notes}</Text>
          </View>
        )}

        {isPending && (
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={() => handleUpdateOrderStatus(item.id, 'rejected')}
            >
              <Text style={styles.rejectText}>رد سفارش</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.approveBtn}
              onPress={() => handleUpdateOrderStatus(item.id, 'approved')}
            >
              <Text style={styles.approveText}>تایید سفارش</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  const renderProofItem = ({ item }: { item: any }) => {
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.invoiceTitle}>
              حواله {toPersianDigits(item.invoiceNumber || item.invoiceId || item.id)}
            </Text>
            <Text style={styles.driverSub}>راننده: {item.driverName || '—'}</Text>
          </View>
          <Text style={styles.dateVal}>
            {formatJalaliDate(item.deliveredAt || item.createdAt)}
          </Text>
        </View>

        {/* Photos Preview */}
        <View style={styles.proofImagesRow}>
          {item.photoBillUrl && (
            <View style={styles.thumbBox}>
              <Text style={styles.thumbLabel}>بارنامه</Text>
              <Image source={{ uri: item.photoBillUrl }} style={styles.thumb} />
            </View>
          )}

          {item.photoScaleUrl && (
            <View style={styles.thumbBox}>
              <Text style={styles.thumbLabel}>باسکول</Text>
              <Image source={{ uri: item.photoScaleUrl }} style={styles.thumb} />
            </View>
          )}

          {item.signatureUrl && (
            <View style={styles.thumbBox}>
              <Text style={styles.thumbLabel}>امضای مرغدار</Text>
              <Image source={{ uri: item.signatureUrl }} style={styles.thumb} />
            </View>
          )}
        </View>

        {/* GPS location */}
        {item.latitude && item.longitude && (
          <View style={styles.gpsRow}>
            <Text style={styles.gpsLabel}>موقعیت ثبت‌شده:</Text>
            <Text style={styles.gpsVal}>
              {toPersianDigits(`${Number(item.latitude).toFixed(4)}, ${Number(item.longitude).toFixed(4)}`)}
            </Text>
          </View>
        )}
      </View>
    );
  };

  const isCurrentLoading = activeTab === 'orders' ? ordersLoading : proofsLoading;
  const isCurrentRefetching = activeTab === 'orders' ? isRefetchingOrders : isRefetchingProofs;
  const handleRefetch = activeTab === 'orders' ? refetchOrders : refetchProofs;

  return (
    <ScreenContainer
      title="کارتابل تاییدات مدیریت"
      scrollable={false}
      onRefresh={handleRefetch}
      refreshing={isCurrentRefetching}
      showBack={!!navigation?.canGoBack?.()}
      onBack={() => navigation?.goBack?.()}
    >
      {/* Tab Switcher */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'orders' && styles.tabActive]}
          onPress={() => setActiveTab('orders')}
        >
          <Text style={[styles.tabText, activeTab === 'orders' && styles.tabTextActive]}>
            سفارش‌های جیره ({toPersianDigits(orders.length)})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'proofs' && styles.tabActive]}
          onPress={() => setActiveTab('proofs')}
        >
          <Text style={[styles.tabText, activeTab === 'proofs' && styles.tabTextActive]}>
            رسیدهای تحویل بار ({toPersianDigits(proofs.length)})
          </Text>
        </TouchableOpacity>
      </View>

      {isCurrentLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>در حال بارگذاری کارتابل...</Text>
        </View>
      ) : activeTab === 'orders' ? (
        orders.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>هیچ سفارشی در انتظار بررسی نیست.</Text>
          </View>
        ) : (
          <FlatList
            data={orders}
            keyExtractor={(item) => String(item.id)}
            renderItem={renderOrderItem}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          />
        )
      ) : proofs.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>رسیدی جهت نمایش ثبت نشده است.</Text>
        </View>
      ) : (
        <FlatList
          data={proofs}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderProofItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  tabContainer: {
    flexDirection: 'row-reverse',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 4,
    marginBottom: 12,
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
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#64748b',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  listContent: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
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
  farmerName: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
  },
  invoiceTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
  },
  driverSub: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  dateVal: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#94a3b8',
  },
  row: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginVertical: 3,
  },
  label: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
  },
  value: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#1e293b',
  },
  weightVal: {
    fontFamily: 'Vazirmatn_700Bold',
    color: '#0284c7',
  },
  notesBox: {
    backgroundColor: '#f8fafc',
    padding: 8,
    borderRadius: 6,
    marginVertical: 6,
  },
  notesLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    textAlign: 'right',
  },
  notesVal: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#334155',
    textAlign: 'right',
    marginTop: 2,
  },
  actionRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
  },
  approveBtn: {
    flex: 1,
    backgroundColor: '#16a34a',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 12,
    color: '#ffffff',
  },
  rejectBtn: {
    flex: 1,
    backgroundColor: '#fee2e2',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  rejectText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#dc2626',
  },
  proofImagesRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginVertical: 10,
  },
  thumbBox: {
    flex: 1,
    alignItems: 'center',
  },
  thumbLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    marginBottom: 4,
  },
  thumb: {
    width: '100%',
    height: 70,
    borderRadius: 6,
    backgroundColor: '#f1f5f9',
    resizeMode: 'cover',
  },
  gpsRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    backgroundColor: '#f8fafc',
    padding: 6,
    borderRadius: 6,
  },
  gpsLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
  },
  gpsVal: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
    color: '#16a34a',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 13,
    color: '#64748b',
    marginTop: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  emptyText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
  },
});

export default ApprovalsScreen;

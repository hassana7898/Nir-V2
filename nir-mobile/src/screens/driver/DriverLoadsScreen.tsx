import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { apiClient } from '../../api/client';
import { formatWeight, toPersianDigits } from '../../utils/formatters';

interface DriverLoadItem {
  id: string;
  invoiceNumber?: string;
  remittanceNumber?: string;
  farmerName?: string;
  productName?: string;
  weight?: number | string;
  status: string;
  destinationPhone?: string;
  origin?: string;
  createdAt?: string;
}

export function DriverLoadsScreen({ navigation }: any) {
  const [activeTab, setActiveTab] = useState<'active' | 'delivered'>('active');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['driver-loads'],
    queryFn: async () => {
      const res = await apiClient.get('/api/mobile/driver/loads');
      return res.data;
    },
  });

  const activeLoads: DriverLoadItem[] = data?.activeLoads || [];
  const deliveredLoads: DriverLoadItem[] = data?.deliveredLoads || [];
  const displayedLoads = activeTab === 'active' ? activeLoads : deliveredLoads;

  const handleCall = (phone?: string) => {
    if (phone) {
      Linking.openURL(`tel:${phone}`);
    }
  };

  const renderLoadCard = ({ item }: { item: DriverLoadItem }) => {
    const invoiceNum = item.invoiceNumber || item.remittanceNumber || item.id;
    const isDelivered = item.status === 'delivered';

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <StatusBadge status={item.status} />
          <View style={styles.invoiceNumberBox}>
            <Text style={styles.invoiceLabel}>حواله:</Text>
            <Text style={styles.invoiceValue}>{toPersianDigits(invoiceNum)}</Text>
          </View>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>نام خریدار / مرغدار:</Text>
          <Text style={styles.infoValue}>{item.farmerName || 'نامشخص'}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>نوع کالا:</Text>
          <Text style={styles.infoValue}>{item.productName || 'خوراک طیور'}</Text>
        </View>

        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>وزن بارنامه:</Text>
          <Text style={[styles.infoValue, styles.weightText]}>
            {formatWeight(item.weight || 0)}
          </Text>
        </View>

        {item.origin && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>مبدأ بارگیری:</Text>
            <Text style={styles.infoValue}>{item.origin}</Text>
          </View>
        )}

        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.detailBtn}
            onPress={() => navigation.navigate('LoadDetail', { load: item })}
          >
            <Text style={styles.detailBtnText}>مشاهده جزئیات و باسکول</Text>
          </TouchableOpacity>

          {item.destinationPhone && (
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => handleCall(item.destinationPhone)}
            >
              <Text style={styles.callBtnText}>تماس</Text>
            </TouchableOpacity>
          )}

          {!isDelivered && (
            <TouchableOpacity
              style={styles.podBtn}
              onPress={() =>
                navigation.navigate('DeliveryProof', {
                  invoiceId: item.id,
                  load: item,
                })
              }
            >
              <Text style={styles.podBtnText}>ثبت تحویل</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer
      title="بارهای ناوگان حمل"
      scrollable={false}
      onRefresh={refetch}
      refreshing={isRefetching}
    >
      {/* Active vs Delivered Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'active' && styles.tabActive]}
          onPress={() => setActiveTab('active')}
        >
          <Text style={[styles.tabText, activeTab === 'active' && styles.tabTextActive]}>
            بارهای فعال ({toPersianDigits(activeLoads.length)})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.tab, activeTab === 'delivered' && styles.tabActive]}
          onPress={() => setActiveTab('delivered')}
        >
          <Text style={[styles.tabText, activeTab === 'delivered' && styles.tabTextActive]}>
            تحویل‌شده ({toPersianDigits(deliveredLoads.length)})
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>در حال دریافت لیست بارها...</Text>
        </View>
      ) : displayedLoads.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>
            {activeTab === 'active'
              ? 'در حال حاضر هیچ بار فعالی برای شما ثبت نشده است.'
              : 'سابقه‌ای از بارهای تحویل‌شده یافت نشد.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayedLoads}
          keyExtractor={(item) => item.id}
          renderItem={renderLoadCard}
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
    paddingBottom: 20,
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
  invoiceNumberBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
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
  infoRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 4,
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
  },
  weightText: {
    fontFamily: 'Vazirmatn_700Bold',
    color: '#0284c7',
  },
  cardActions: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
  },
  detailBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  detailBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#334155',
  },
  callBtn: {
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  callBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#0369a1',
  },
  podBtn: {
    backgroundColor: '#16a34a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  podBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#ffffff',
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
    marginTop: 10,
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

export default DriverLoadsScreen;

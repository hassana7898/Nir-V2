import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { apiClient } from '../../api/client';
import { Endpoints } from '../../api/endpoints';
import { formatWeight, toPersianDigits } from '../../utils/formatters';

export function FarmersDirectoryScreen({ navigation }: any) {
  const [search, setSearch] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager', 'farmers-directory'],
    queryFn: async () => {
      const res = await apiClient.get(Endpoints.web.farmers);
      return (res.data?.data || []) as any[];
    },
  });

  const farmers = (data || []).filter((f: any) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    const name = (f.name || '').toLowerCase();
    const phone = (f.phone || '').toLowerCase();
    const addr = (f.address || '').toLowerCase();
    return name.includes(q) || phone.includes(q) || addr.includes(q);
  });

  const handleCall = (phone: string) => {
    if (phone) {
      Linking.openURL(`tel:${phone}`);
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    const activeBroods = item.broods || [];

    return (
      <View style={styles.card}>
        {/* Farmer Header */}
        <View style={styles.cardHeader}>
          {item.phone ? (
            <TouchableOpacity style={styles.callBtn} onPress={() => handleCall(item.phone)}>
              <Text style={styles.callBtnText}>📞 تماس</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.farmerName}>{item.name}</Text>
        </View>

        {/* Details row */}
        <View style={styles.detailRow}>
          <Text style={styles.detailVal}>{toPersianDigits(item.capacity || 0)} قطعه</Text>
          <Text style={styles.detailLabel}>ظرفیت کل مرغداری:</Text>
        </View>

        <View style={styles.detailRow}>
          <Text style={styles.detailVal}>{toPersianDigits(item.hallCount || 0)} سالن</Text>
          <Text style={styles.detailLabel}>تعداد سالن‌های پرورش:</Text>
        </View>

        {item.address ? (
          <Text style={styles.addressText}>📍 {item.address}</Text>
        ) : null}

        {/* Brood Periods section */}
        <View style={styles.broodsSection}>
          <Text style={styles.broodsTitle}>دوره‌های پرورش فعال:</Text>
          {activeBroods.length > 0 ? (
            activeBroods.map((b: any) => (
              <View key={b.id} style={styles.broodItem}>
                <View style={styles.broodHeader}>
                  <Text style={styles.broodAgeBadge}>سن گله: {toPersianDigits(b.currentAgeDays || 0)} روز</Text>
                  <Text style={styles.broodName}>{b.name}</Text>
                </View>
                <View style={styles.broodStatsRow}>
                  <Text style={styles.broodStatText}>تعداد جوجه: {toPersianDigits(b.chickCount || 0)} قطعه</Text>
                  <Text style={styles.broodStatText}>دان مصرفی: {formatWeight(b.totalFeedTonnage || 0)}</Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.noBroodText}>در حال حاضر دوره فعال ثبت نشده است.</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer
      title="فهرست مرغداران آرادان"
      subtitle="مدیریت واحدهای پرورشی و دوره‌های فعال جوجه‌ریزی"
      showBack={!!navigation?.canGoBack?.()}
      onBack={() => navigation?.goBack?.()}
    >
      <View style={styles.searchBox}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="جستجوی نام مرغدار، تلفن، آدرس..."
          placeholderTextColor="#94a3b8"
        />
      </View>

      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>در حال دریافت لیست مرغداران...</Text>
        </View>
      ) : (
        <FlatList
          data={farmers}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>مرغداری با این مشخصات یافت نشد.</Text>
            </View>
          }
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  searchBox: {
    marginBottom: 12,
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
    textAlign: 'right',
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
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 8,
  },
  farmerName: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 15,
    color: '#0f172a',
  },
  callBtn: {
    backgroundColor: '#f0fdf4',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  callBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#16a34a',
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  detailLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
  },
  detailVal: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#1e293b',
  },
  addressText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 6,
    textAlign: 'right',
  },
  broodsSection: {
    marginTop: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
  },
  broodsTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 12,
    color: '#334155',
    marginBottom: 6,
    textAlign: 'right',
  },
  broodItem: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    padding: 8,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  broodHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  broodName: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 12,
    color: '#0369a1',
  },
  broodAgeBadge: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 10,
    color: '#16a34a',
    backgroundColor: '#f0fdf4',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  broodStatsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  broodStatText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#64748b',
  },
  noBroodText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    paddingVertical: 4,
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

export default FarmersDirectoryScreen;

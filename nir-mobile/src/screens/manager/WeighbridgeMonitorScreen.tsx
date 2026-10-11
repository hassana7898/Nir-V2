import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { apiClient } from '../../api/client';
import { formatWeight, toPersianDigits } from '../../utils/formatters';

interface WeighbridgeRecordItem {
  id: number;
  externalId: number;
  ticketNumber?: string;
  plateNumber?: string;
  driverName?: string;
  customerName?: string;
  goods?: string;
  grossWeight?: string | number;
  tareWeight?: string | number;
  netWeight?: string | number;
  weighTime?: string;
  direction: string;
  status: string;
  mappedRemittanceId?: string | null;
  remittanceNumber?: string | null;
  isMismatch?: boolean;
}

export function WeighbridgeMonitorScreen() {
  const [filter, setFilter] = useState<'all' | 'done' | 'pending' | 'mismatch'>('all');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager-weighbridge'],
    queryFn: async () => {
      const res = await apiClient.get('/api/mobile/manager/weighbridge');
      return res.data;
    },
  });

  const records: WeighbridgeRecordItem[] = data?.records || [];

  const filteredRecords = records.filter((r) => {
    const hasNet = Number(r.netWeight) > 0;
    if (filter === 'done') return hasNet;
    if (filter === 'pending') return !hasNet;
    if (filter === 'mismatch') return !!r.isMismatch;
    return true;
  });

  const renderTicketCard = ({ item }: { item: WeighbridgeRecordItem }) => {
    const isMapped = !!item.mappedRemittanceId;
    const netWeight = Number(item.netWeight) || 0;

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.ticketBox}>
            <Text style={styles.ticketLabel}>قبض:</Text>
            <Text style={styles.ticketNum}>
              {toPersianDigits(item.ticketNumber || item.externalId)}
            </Text>
          </View>

          <View style={styles.statusBox}>
            {isMapped ? (
              <StatusBadge status="success" label="✓ حواله متصل شد" size="sm" />
            ) : (
              <StatusBadge status="warning" label="بدون حواله" size="sm" />
            )}
          </View>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>کالا / نهاده:</Text>
          <Text style={styles.value}>{item.goods || 'کالای نامشخص'}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>مشتری / مرغدار:</Text>
          <Text style={styles.value}>{item.customerName || '—'}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.label}>راننده و خودرو:</Text>
          <Text style={styles.value}>
            {item.driverName || '—'} {item.plateNumber ? `(${toPersianDigits(item.plateNumber)})` : ''}
          </Text>
        </View>

        {/* Weights & Time */}
        <View style={styles.weightRow}>
          <View>
            <Text style={styles.weightLabel}>وزن خالص باسکول:</Text>
            <Text style={[styles.weightVal, netWeight > 0 ? styles.netDone : styles.netPending]}>
              {netWeight > 0 ? formatWeight(netWeight) : 'در انتظار خروج'}
            </Text>
          </View>

          {item.weighTime && (
            <View style={styles.timeBox}>
              <Text style={styles.timeLabel}>زمان توزین:</Text>
              <Text style={styles.timeVal}>{toPersianDigits(item.weighTime)}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer
      title="مانیتورینگ باسکول دیجیتال"
      subtitle="توزین‌نگار کارخانه آرادان"
      scrollable={false}
      onRefresh={refetch}
      refreshing={isRefetching}
    >
      {/* Filter Tabs */}
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterPill, filter === 'all' && styles.filterPillActive]}
          onPress={() => setFilter('all')}
        >
          <Text style={[styles.filterText, filter === 'all' && styles.filterTextActive]}>
            همه ({toPersianDigits(records.length)})
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterPill, filter === 'done' && styles.filterPillActive]}
          onPress={() => setFilter('done')}
        >
          <Text style={[styles.filterText, filter === 'done' && styles.filterTextActive]}>
            خالص‌شده
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterPill, filter === 'pending' && styles.filterPillActive]}
          onPress={() => setFilter('pending')}
        >
          <Text style={[styles.filterText, filter === 'pending' && styles.filterTextActive]}>
            ناخالص
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterPill, filter === 'mismatch' && styles.filterPillActive]}
          onPress={() => setFilter('mismatch')}
        >
          <Text style={[styles.filterText, filter === 'mismatch' && styles.filterTextActive]}>
            مغایرت
          </Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>در حال دریافت رکوردهای توزین...</Text>
        </View>
      ) : filteredRecords.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>رکوردی مطابق فیلتر انتخابی یافت نشد.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredRecords}
          keyExtractor={(item) => String(item.id || item.externalId)}
          renderItem={renderTicketCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: 'row-reverse',
    gap: 6,
    marginBottom: 12,
  },
  filterPill: {
    flex: 1,
    backgroundColor: '#ffffff',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  filterPillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#0284c7',
  },
  filterText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#64748b',
  },
  filterTextActive: {
    color: '#ffffff',
  },
  listContent: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
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
  ticketBox: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  ticketLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
  },
  ticketNum: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
  },
  statusBox: {
    alignItems: 'flex-start',
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
  weightRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 8,
    marginTop: 8,
  },
  weightLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#475569',
  },
  weightVal: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    marginTop: 2,
  },
  netDone: {
    color: '#16a34a',
  },
  netPending: {
    color: '#d97706',
  },
  timeBox: {
    alignItems: 'flex-start',
  },
  timeLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
  },
  timeVal: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#0f172a',
    marginTop: 2,
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

export default WeighbridgeMonitorScreen;

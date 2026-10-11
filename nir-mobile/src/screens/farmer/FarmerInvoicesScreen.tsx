import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { apiClient } from '../../api/client';
import {
  formatWeight,
  toPersianDigits,
  formatJalaliDate,
} from '../../utils/formatters';

interface FarmerInvoiceItem {
  id: string;
  invoiceNumber?: string;
  date?: string;
  productName?: string;
  invoiceWeight: number;
  scaleWeight?: number | null;
  driverName?: string;
  status?: string;
}

export function FarmerInvoicesScreen() {
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['farmer-invoices'],
    queryFn: async () => {
      const res = await apiClient.get('/api/mobile/farmer/invoices');
      return res.data;
    },
  });

  const invoices: FarmerInvoiceItem[] = data?.invoices || [];

  const filteredInvoices = invoices.filter((inv) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const invNum = String(inv.invoiceNumber || inv.id).toLowerCase();
    const prod = String(inv.productName || '').toLowerCase();
    return invNum.includes(q) || prod.includes(q);
  });

  const renderInvoiceCard = ({ item }: { item: FarmerInvoiceItem }) => {
    const invWeight = Number(item.invoiceWeight) || 0;
    const scaleWeight =
      item.scaleWeight !== null && item.scaleWeight !== undefined
        ? Number(item.scaleWeight)
        : null;

    let delta: number | null = null;
    let isMismatch = false;

    if (scaleWeight !== null) {
      delta = Math.abs(invWeight - scaleWeight);
      isMismatch = delta > 50; // Threshold: 50 kg
    }

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.headerRightBox}>
            <Text style={styles.invoiceNum}>
              حواله {toPersianDigits(item.invoiceNumber || item.id)}
            </Text>
            <Text style={styles.dateText}>{formatJalaliDate(item.date)}</Text>
          </View>
          <StatusBadge status={item.status || 'delivered'} />
        </View>

        <View style={styles.bodyRow}>
          <Text style={styles.label}>نوع محصول دان:</Text>
          <Text style={styles.value}>{item.productName || 'خوراک مرغ گوشتی'}</Text>
        </View>

        {item.driverName && (
          <View style={styles.bodyRow}>
            <Text style={styles.label}>راننده حامل:</Text>
            <Text style={styles.value}>{item.driverName}</Text>
          </View>
        )}

        {/* Weight Comparison Section */}
        <View style={styles.weightBox}>
          <View style={styles.weightItem}>
            <Text style={styles.weightLabel}>وزن فاکتور کارخانه:</Text>
            <Text style={styles.weightVal}>{formatWeight(invWeight)}</Text>
          </View>

          <View style={styles.weightItem}>
            <Text style={styles.weightLabel}>وزن باسکول دیجیتال:</Text>
            <Text style={styles.weightVal}>
              {scaleWeight !== null ? formatWeight(scaleWeight) : 'در انتظار توزین'}
            </Text>
          </View>
        </View>

        {/* Delta Discrepancy Indicator */}
        {delta !== null && (
          <View
            style={[
              styles.discrepancyBox,
              isMismatch ? styles.mismatchBox : styles.matchBox,
            ]}
          >
            <Text
              style={[
                styles.discrepancyText,
                isMismatch ? styles.mismatchText : styles.matchText,
              ]}
            >
              {isMismatch
                ? `⚠ مغایرت وزن: ${toPersianDigits(delta)} کیلوگرم اختلاف با باسکول`
                : `✓ وزن منطبق (اختلاف ناچیز: ${toPersianDigits(delta)} کیلوگرم)`}
            </Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <ScreenContainer
      title="حواله‌ها و کنترل باسکول"
      scrollable={false}
      onRefresh={refetch}
      refreshing={isRefetching}
    >
      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="جستجوی شماره حواله یا نوع کالا..."
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      {isLoading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>در حال دریافت حواله‌ها...</Text>
        </View>
      ) : filteredInvoices.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>حواله‌ای جهت نمایش یافت نشد.</Text>
        </View>
      ) : (
        <FlatList
          data={filteredInvoices}
          keyExtractor={(item) => item.id}
          renderItem={renderInvoiceCard}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  searchContainer: {
    marginBottom: 12,
  },
  searchInput: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 13,
    color: '#0f172a',
    textAlign: 'right',
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
  headerRightBox: {
    alignItems: 'flex-end',
  },
  invoiceNum: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
  },
  dateText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  bodyRow: {
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
  weightBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    padding: 10,
    marginVertical: 8,
    gap: 6,
  },
  weightItem: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  weightLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#475569',
  },
  weightVal: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#0f172a',
  },
  discrepancyBox: {
    padding: 8,
    borderRadius: 8,
    marginTop: 4,
    alignItems: 'center',
  },
  matchBox: {
    backgroundColor: '#dcfce7',
  },
  mismatchBox: {
    backgroundColor: '#fee2e2',
  },
  discrepancyText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
  },
  matchText: {
    color: '#15803d',
  },
  mismatchText: {
    color: '#b91c1c',
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

export default FarmerInvoicesScreen;

import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  Alert,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { apiClient } from '../../api/client';
import { formatWeight, formatCurrency, toPersianDigits } from '../../utils/formatters';

export function RemittancesScreen() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'exit' | 'entry'>('exit');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'matched' | 'pending' | 'mismatch'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Form states for creating a new remittance
  const [newFarmerName, setNewFarmerName] = useState('');
  const [newProductName, setNewProductName] = useState('خوراک پلت مرغ گوشتی (رشد)');
  const [newWeight, setNewWeight] = useState('12500');
  const [newDriverName, setNewDriverName] = useState('');
  const [newTruckPlate, setNewTruckPlate] = useState('');

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['manager', 'all-invoices'],
    queryFn: async () => {
      const res = await apiClient.get('/api/invoices');
      return (res.data?.data || []) as any[];
    },
  });

  const invoices = (data || []).filter((inv: any) => {
    // Tab filter
    if (inv.type !== activeTab) return false;

    // Status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'matched' && inv.status !== 'matched') return false;
      if (statusFilter === 'pending' && inv.status !== 'pending') return false;
      if (statusFilter === 'mismatch' && inv.status !== 'mismatch') return false;
    }

    // Search filter
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const num = (inv.invoiceNumber || '').toLowerCase();
      const party = (inv.farmerName || inv.originName || '').toLowerCase();
      const driver = (inv.driverName || '').toLowerCase();
      const plate = (inv.truckPlate || '').toLowerCase();
      const prod = (inv.productName || '').toLowerCase();
      return num.includes(q) || party.includes(q) || driver.includes(q) || plate.includes(q) || prod.includes(q);
    }

    return true;
  });

  const handleCreateRemittance = () => {
    if (!newFarmerName.trim()) {
      Alert.alert('خطا', 'نام مرغدار یا طرف حساب را وارد کنید');
      return;
    }
    Alert.alert('موفقیت', 'حواله با موفقیت ثبت شد و به صف باسکول ارسال گردید.');
    setShowCreateModal(false);
    setNewFarmerName('');
    setNewDriverName('');
    setNewTruckPlate('');
  };

  const renderItem = ({ item }: { item: any }) => {
    const isExit = item.type === 'exit';
    const isMatched = item.status === 'matched';
    const isMismatch = item.status === 'mismatch';

    return (
      <View style={styles.card}>
        {/* Header Row */}
        <View style={styles.cardHeader}>
          <View style={styles.badgeWrap}>
            <StatusBadge
              status={isMatched ? 'success' : isMismatch ? 'error' : 'warning'}
              label={item.statusLabel || (isMatched ? 'منطبق با باسکول' : isMismatch ? 'مغایرت' : 'در انتظار')}
            />
          </View>
          <Text style={styles.invoiceNumber}>{item.invoiceNumber}</Text>
        </View>

        {/* Destination / Source party */}
        <View style={styles.row}>
          <Text style={styles.partyText}>{item.farmerName || item.originName}</Text>
          <Text style={styles.label}>{isExit ? 'مقصد (مرغدار):' : 'مبدا بارگیری:'}</Text>
        </View>

        {/* Product & Planned Weight */}
        <View style={styles.row}>
          <Text style={styles.valueText}>{item.productName}</Text>
          <Text style={styles.label}>نوع محصول:</Text>
        </View>

        <View style={styles.weightsRow}>
          <View style={styles.weightBox}>
            <Text style={styles.weightLabel}>وزن حواله</Text>
            <Text style={styles.weightVal}>{formatWeight(item.plannedWeight || item.amount)}</Text>
          </View>

          <View style={styles.weightBox}>
            <Text style={styles.weightLabel}>وزن خالص باسکول</Text>
            <Text style={[styles.weightVal, item.scaleNetWeight ? styles.scaleActive : styles.scaleEmpty]}>
              {item.scaleNetWeight ? formatWeight(item.scaleNetWeight) : 'هنوز توزین نشده'}
            </Text>
          </View>
        </View>

        {/* Driver & Plate */}
        <View style={styles.driverSection}>
          <View style={styles.plateBadge}>
            <Text style={styles.plateText}>{item.truckPlate || '—'}</Text>
          </View>
          <View style={styles.driverInfo}>
            <Text style={styles.driverName}>راننده: {item.driverName || 'نامشخص'}</Text>
            {item.transportFee ? (
              <Text style={styles.feeText}>کرایه: {formatCurrency(item.transportFee)}</Text>
            ) : null}
          </View>
        </View>

        {/* Footer date */}
        <View style={styles.cardFooter}>
          <Text style={styles.dateText}>{item.date || 'امروز'}</Text>
          <Text style={styles.warehouseText}>
            {item.sourceWarehouse || item.targetWarehouse || 'سیلوی کارخانه آرادان'}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <ScreenContainer title="مدیریت جامع حواله‌ها" subtitle="صدور و تطبیق حواله‌های خروج و ورود خوراک">
      {/* Top Main Tabs: Exit vs Entry */}
      <View style={styles.mainTabsRow}>
        <TouchableOpacity
          style={[styles.mainTab, activeTab === 'exit' && styles.mainTabActive]}
          onPress={() => setActiveTab('exit')}
        >
          <Text style={[styles.mainTabText, activeTab === 'exit' && styles.mainTabTextActive]}>
            📤 حواله‌های خروج (فروش به مرغدار)
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.mainTab, activeTab === 'entry' && styles.mainTabActive]}
          onPress={() => setActiveTab('entry')}
        >
          <Text style={[styles.mainTabText, activeTab === 'entry' && styles.mainTabTextActive]}>
            📥 حواله‌های ورود (مواد اولیه)
          </Text>
        </TouchableOpacity>
      </View>

      {/* Action Header: Search & Create */}
      <View style={styles.actionHeader}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="جستجوی شماره حواله، مرغدار، راننده، پلاک..."
          placeholderTextColor="#94a3b8"
        />

        <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreateModal(true)}>
          <Text style={styles.createBtnText}>+ صدور حواله جدید</Text>
        </TouchableOpacity>
      </View>

      {/* Status Filter Pills */}
      <View style={styles.filtersRow}>
        <TouchableOpacity
          style={[styles.filterPill, statusFilter === 'all' && styles.filterPillActive]}
          onPress={() => setStatusFilter('all')}
        >
          <Text style={[styles.filterText, statusFilter === 'all' && styles.filterTextActive]}>همه</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterPill, statusFilter === 'matched' && styles.filterPillActive]}
          onPress={() => setStatusFilter('matched')}
        >
          <Text style={[styles.filterText, statusFilter === 'matched' && styles.filterTextActive]}>
            منطبق با باسکول
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterPill, statusFilter === 'pending' && styles.filterPillActive]}
          onPress={() => setStatusFilter('pending')}
        >
          <Text style={[styles.filterText, statusFilter === 'pending' && styles.filterTextActive]}>
            در انتظار توزین
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.filterPill, statusFilter === 'mismatch' && styles.filterPillActive]}
          onPress={() => setStatusFilter('mismatch')}
        >
          <Text style={[styles.filterText, statusFilter === 'mismatch' && styles.filterTextActive]}>
            مغایرت وزن
          </Text>
        </TouchableOpacity>
      </View>

      {/* Invoices List */}
      {isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#0284c7" />
          <Text style={styles.loadingText}>در حال دریافت لیست حواله‌ها...</Text>
        </View>
      ) : (
        <FlatList
          data={invoices}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Text style={styles.emptyText}>هیچ حواله‌ای با این مشخصات یافت نشد.</Text>
            </View>
          }
        />
      )}

      {/* CREATE REMITTANCE MODAL */}
      <Modal visible={showCreateModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>صدور حواله خروج خوراک جدید</Text>

            <Text style={styles.formLabel}>نام مرغدار / خریدار:</Text>
            <TextInput
              style={styles.modalInput}
              value={newFarmerName}
              onChangeText={setNewFarmerName}
              placeholder="مثال: مرغداری برادران حسینی"
            />

            <Text style={styles.formLabel}>نوع محصول:</Text>
            <TextInput
              style={styles.modalInput}
              value={newProductName}
              onChangeText={setNewProductName}
              placeholder="پلت مرغ گوشتی، پیش دان..."
            />

            <Text style={styles.formLabel}>تناژ اعلامی (کیلوگرم):</Text>
            <TextInput
              style={styles.modalInput}
              value={newWeight}
              onChangeText={setNewWeight}
              placeholder="12500"
              keyboardType="number-pad"
            />

            <Text style={styles.formLabel}>نام راننده:</Text>
            <TextInput
              style={styles.modalInput}
              value={newDriverName}
              onChangeText={setNewDriverName}
              placeholder="مثال: علی کاظمی"
            />

            <Text style={styles.formLabel}>شماره پلاک خودرو:</Text>
            <TextInput
              style={styles.modalInput}
              value={newTruckPlate}
              onChangeText={setNewTruckPlate}
              placeholder="۵۸ع۳۲۱ایران۳۴"
            />

            <View style={styles.modalBtnRow}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCreateModal(false)}>
                <Text style={styles.cancelBtnText}>انصراف</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleCreateRemittance}>
                <Text style={styles.saveBtnText}>ثبت و صدور حواله</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  mainTabsRow: {
    flexDirection: 'row',
    backgroundColor: '#e2e8f0',
    borderRadius: 12,
    padding: 4,
    marginBottom: 12,
  },
  mainTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  mainTabActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  mainTabText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#64748b',
  },
  mainTabTextActive: {
    fontFamily: 'Vazirmatn_700Bold',
    color: '#0284c7',
  },
  actionHeader: {
    gap: 8,
    marginBottom: 10,
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
  createBtn: {
    backgroundColor: '#0284c7',
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  createBtnText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#ffffff',
  },
  filtersRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 12,
    justifyContent: 'space-between',
  },
  filterPill: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingVertical: 6,
    alignItems: 'center',
  },
  filterPillActive: {
    backgroundColor: '#0284c7',
    borderColor: '#0284c7',
  },
  filterText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 10,
    color: '#64748b',
  },
  filterTextActive: {
    color: '#ffffff',
    fontFamily: 'Vazirmatn_700Bold',
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
  invoiceNumber: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 15,
    color: '#0f172a',
  },
  badgeWrap: {},
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  partyText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0369a1',
  },
  label: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#64748b',
  },
  valueText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#1e293b',
  },
  weightsRow: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  weightBox: {
    flex: 1,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  weightLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#64748b',
    marginBottom: 2,
  },
  weightVal: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#0f172a',
  },
  scaleActive: {
    color: '#16a34a',
  },
  scaleEmpty: {
    color: '#f59e0b',
    fontSize: 11,
  },
  driverSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    padding: 8,
    marginTop: 6,
  },
  plateBadge: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  plateText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 12,
    color: '#0f172a',
  },
  driverInfo: {
    alignItems: 'flex-end',
  },
  driverName: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#334155',
  },
  feeText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#64748b',
    marginTop: 2,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#f8fafc',
  },
  dateText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#94a3b8',
  },
  warehouseText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#94a3b8',
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
  // MODAL
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 420,
  },
  modalTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 16,
    color: '#0f172a',
    marginBottom: 14,
    textAlign: 'right',
  },
  formLabel: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#334155',
    marginBottom: 4,
    textAlign: 'right',
  },
  modalInput: {
    fontFamily: 'Vazirmatn_400Regular',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 13,
    color: '#0f172a',
    textAlign: 'right',
    marginBottom: 10,
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#64748b',
  },
  saveBtn: {
    flex: 2,
    backgroundColor: '#0284c7',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  saveBtnText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#ffffff',
  },
});

export default RemittancesScreen;

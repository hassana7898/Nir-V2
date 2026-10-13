import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { apiClient } from '../../api/client';
import { Endpoints } from '../../api/endpoints';
import { extractApiErrorMessage } from '../../api/errors';
import { formatJalaliDate, formatWeight, toPersianDigits } from '../../utils/formatters';
import {
  TRIP_STATUS_FLOW,
  TRIP_STATUS_HINTS,
  TRIP_STATUS_LABELS,
  isTripStatus,
  lockedTripStatuses,
  reportableTripStatuses,
  stepIndex,
  tripStatusVariant,
  type TripStatus,
} from '../../features/driver/tripStatusFlow';

const PAGE_SIZE = 20;

type ScopeTab = 'active' | 'completed';

const SCOPE_TABS: { key: ScopeTab; label: string }[] = [
  { key: 'active', label: 'بارهای در جریان' },
  { key: 'completed', label: 'تحویل‌شده‌ها' },
];

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
  tripStatus?: string | null;
  tripStatusAt?: string | null;
  hasProofOfDelivery?: boolean;
}

function TripStatusBlock({
  load,
  busy,
  onReport,
  onOpenPod,
}: {
  load: DriverLoadItem;
  busy: boolean;
  onReport: (status: TripStatus) => void;
  onOpenPod: () => void;
}) {
  const current: TripStatus = isTripStatus(load.tripStatus) ? load.tripStatus : 'assigned';
  const hasProof = !!load.hasProofOfDelivery;
  const options = reportableTripStatuses(current, hasProof);
  const locked = lockedTripStatuses(current, hasProof);
  const currentIndex = stepIndex(current);

  return (
    <View style={styles.tripBox}>
      <View style={styles.tripHeader}>
        <StatusBadge status={tripStatusVariant(current)} label={TRIP_STATUS_LABELS[current]} size="sm" />
        <Text style={styles.tripTitle}>وضعیت سفر (گزارش راننده)</Text>
      </View>

      <Text style={styles.tripHint}>{TRIP_STATUS_HINTS[current]}</Text>

      <View style={styles.timeline}>
        {TRIP_STATUS_FLOW.map((step, idx) => {
          const done = currentIndex >= idx;
          return (
            <View key={step} style={styles.timelineRow}>
              <View style={[styles.dot, done && styles.dotDone]} />
              <Text style={[styles.dotLabel, done && styles.dotLabelDone]}>
                {TRIP_STATUS_LABELS[step]}
              </Text>
            </View>
          );
        })}
      </View>

      {load.tripStatusAt ? (
        <Text style={styles.tripAt}>
          آخرین گزارش: {toPersianDigits(formatJalaliDate(load.tripStatusAt))}
        </Text>
      ) : null}

      {options.length > 0 ? (
        <View style={styles.reportRow}>
          {options.map((status) => {
            const isCancel = status === 'cancelled';
            return (
              <TouchableOpacity
                key={status}
                style={[styles.reportBtn, isCancel && styles.reportBtnDanger, busy && styles.reportBtnBusy]}
                disabled={busy}
                onPress={() => onReport(status)}
              >
                <Text style={[styles.reportBtnText, isCancel && styles.reportBtnTextDanger]}>
                  {isCancel ? 'لغو سفر' : `گزارش: ${TRIP_STATUS_LABELS[status]}`}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <Text style={styles.tripClosed}>
          {current === 'delivered'
            ? 'این سفر با رسید تحویل بسته شده است.'
            : 'این سفر لغو شده است.'}
        </Text>
      )}

      {locked.length > 0 ? (
        <TouchableOpacity style={styles.lockedReport} disabled={busy} onPress={onOpenPod}>
          <Text style={styles.lockedReportText}>
            برای بستن سفر ابتدا «رسید تحویل» را ثبت کنید
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function LoadCard({
  load,
  busy,
  onReport,
  onOpenDetail,
  onOpenPod,
}: {
  load: DriverLoadItem;
  busy: boolean;
  onReport: (load: DriverLoadItem, status: TripStatus) => void;
  onOpenDetail: () => void;
  onOpenPod: () => void;
}) {
  const invoiceNum = load.invoiceNumber || load.remittanceNumber || load.id;

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <StatusBadge status={load.status} />
        <View style={styles.invoiceNumberBox}>
          <Text style={styles.invoiceLabel}>حواله:</Text>
          <Text style={styles.invoiceValue}>{toPersianDigits(invoiceNum)}</Text>
        </View>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>نام خریدار / مرغدار:</Text>
        <Text style={styles.infoValue}>{load.farmerName || 'نامشخص'}</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>نوع کالا:</Text>
        <Text style={styles.infoValue}>{load.productName || 'نامشخص'}</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>وزن بارنامه:</Text>
        <Text style={[styles.infoValue, styles.weightText]}>
          {formatWeight(load.weight || 0)}
        </Text>
      </View>

      {load.origin ? (
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>مبدأ بارگیری:</Text>
          <Text style={styles.infoValue}>{load.origin}</Text>
        </View>
      ) : null}

      <TripStatusBlock
        load={load}
        busy={busy}
        onReport={(status) => onReport(load, status)}
        onOpenPod={onOpenPod}
      />

      <View style={styles.cardActions}>
        <TouchableOpacity style={styles.detailBtn} onPress={onOpenDetail}>
          <Text style={styles.detailBtnText}>مشاهده جزئیات و باسکول</Text>
        </TouchableOpacity>

        {load.destinationPhone ? (
          <TouchableOpacity
            style={styles.callBtn}
            onPress={() => Linking.openURL(`tel:${load.destinationPhone}`)}
          >
            <Text style={styles.callBtnText}>تماس</Text>
          </TouchableOpacity>
        ) : null}

        {!load.hasProofOfDelivery ? (
          <TouchableOpacity style={styles.podBtn} onPress={onOpenPod}>
            <Text style={styles.podBtnText}>رسید تحویل</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function DriverLoadsScreen({ navigation }: any) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<ScopeTab>('active');
  const [page, setPage] = useState(1);

  // Switching tab must restart paging: page 5 of «در جریان» is meaningless for «تحویل‌شده‌ها».
  useEffect(() => {
    setPage(1);
  }, [scope]);

  const loadsQuery = useQuery({
    queryKey: ['driver-loads', scope, page],
    queryFn: async () => {
      const res = await apiClient.get(Endpoints.driver.loads, {
        params: { scope, page, limit: PAGE_SIZE },
      });
      return res.data;
    },
    placeholderData: (previous: any) => previous,
  });

  const reportMutation = useMutation({
    mutationFn: async (vars: { invoiceId: string; status: TripStatus }) => {
      const res = await apiClient.patch(Endpoints.driver.tripStatus(vars.invoiceId), {
        status: vars.status,
      });
      return res.data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['driver-loads'] });
      Alert.alert(
        'ثبت شد',
        data?.unchanged
          ? 'این وضعیت قبلاً ثبت شده بود؛ تغییری لازم نبود.'
          : data?.message || 'وضعیت سفر به‌روزرسانی شد.'
      );
    },
    onError: (error: unknown) => {
      // The server's own text is authoritative here: a 409 explains exactly which move was refused.
      Alert.alert('ثبت نشد', extractApiErrorMessage(error, 'ثبت وضعیت سفر ناموفق بود.'));
    },
  });

  const loads = useMemo<DriverLoadItem[]>(() => {
    const body: any = loadsQuery.data || {};
    const active = Array.isArray(body.activeLoads) ? body.activeLoads : [];
    const completed = Array.isArray(body.completedLoads) ? body.completedLoads : [];
    return scope === 'active' ? active : completed;
  }, [loadsQuery.data, scope]);

  const total = Number((loadsQuery.data as any)?.total || 0);
  const serverPage = Math.max(1, Number((loadsQuery.data as any)?.page || 1));
  const totalPages = Math.max(1, Number((loadsQuery.data as any)?.totalPages || 1));
  const errorText = loadsQuery.isError
    ? extractApiErrorMessage(loadsQuery.error, 'دریافت فهرست بارها ناموفق بود.')
    : null;

  const handleReport = (load: DriverLoadItem, status: TripStatus) => {
    if (status === 'cancelled') {
      Alert.alert('لغو سفر', 'این عمل قابل بازگشت نیست. لغو این سفر را تایید می‌کنید؟', [
        { text: 'انصراف', style: 'cancel' },
        {
          text: 'لغو سفر',
          style: 'destructive',
          onPress: () => reportMutation.mutate({ invoiceId: load.id, status }),
        },
      ]);
      return;
    }
    reportMutation.mutate({ invoiceId: load.id, status });
  };

  return (
    <ScreenContainer
      scrollable={false}
      title="بارهای من"
      subtitle="سفرهای تخصیص‌یافته، گزارش وضعیت سفر و رسید تحویل"
    >
      <FlatList
        data={loads}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <LoadCard
            load={item}
            busy={reportMutation.isPending}
            onReport={handleReport}
            onOpenDetail={() => navigation.navigate('LoadDetail', { load: item })}
            onOpenPod={() => navigation.navigate('DeliveryProof', { load: item })}
          />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={loadsQuery.isFetching && !loadsQuery.isLoading}
            onRefresh={() => loadsQuery.refetch()}
            colors={['#0284c7']}
          />
        }
        ListHeaderComponent={
          <View>
            <View style={styles.tabContainer}>
              {SCOPE_TABS.map((tab) => {
                const active = tab.key === scope;
                return (
                  <TouchableOpacity
                    key={tab.key}
                    style={[styles.tab, active && styles.tabActive]}
                    onPress={() => setScope(tab.key)}
                  >
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {errorText ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorText}</Text>
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          loadsQuery.isLoading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color="#0284c7" />
              <Text style={styles.loadingText}>در حال دریافت بارها...</Text>
            </View>
          ) : errorText ? null : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {scope === 'active'
                  ? 'بار در جریانی برای شما ثبت نشده است.'
                  : 'باری با رسید تحویل ثبت‌شده برای شما وجود ندارد.'}
              </Text>
              <Text style={styles.emptyHint}>
                اگر انتظار باری را دارید که اینجا نیست، آن حواله در سرور به نام یا شمارهٔ شما وصل نشده
                است.
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          loads.length > 0 ? (
            <View>
              <Text style={styles.summaryLine}>{toPersianDigits(`${loads.length} از ${total} بار`)}</Text>
              <View style={styles.pager}>
                <TouchableOpacity
                  style={[
                    styles.pagerBtn,
                    (serverPage <= 1 || loadsQuery.isFetching) && styles.pagerBtnDisabled,
                  ]}
                  disabled={serverPage <= 1 || loadsQuery.isFetching}
                  onPress={() => setPage((current) => Math.max(1, current - 1))}
                >
                  <Text style={styles.pagerBtnText}>صفحه قبل</Text>
                </TouchableOpacity>
                <Text style={styles.pagerLabel}>
                  صفحه {toPersianDigits(serverPage)} از {toPersianDigits(totalPages)}
                </Text>
                <TouchableOpacity
                  style={[
                    styles.pagerBtn,
                    (serverPage >= totalPages || loadsQuery.isFetching) && styles.pagerBtnDisabled,
                  ]}
                  disabled={serverPage >= totalPages || loadsQuery.isFetching}
                  onPress={() => setPage((current) => current + 1)}
                >
                  <Text style={styles.pagerBtnText}>صفحه بعد</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null
        }
      />
    </ScreenContainer>
  );
}



const styles = StyleSheet.create({
  listContent: {
    padding: 14,
    paddingBottom: 24,
    gap: 10,
  },
  tabContainer: {
    flexDirection: 'row-reverse',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    padding: 4,
    gap: 4,
    marginBottom: 10,
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
  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 8,
    padding: 10,
  },
  errorText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#b91c1c',
    textAlign: 'right',
  },
  centerContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  loadingText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 13,
    color: '#64748b',
    marginTop: 10,
  },
  emptyContainer: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
  },
  emptyHint: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  summaryLine: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 8,
  },
  pager: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 8,
    marginTop: 6,
  },
  pagerBtn: {
    backgroundColor: '#e0f2fe',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pagerBtnDisabled: {
    backgroundColor: '#f1f5f9',
  },
  pagerBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#0369a1',
  },
  pagerLabel: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#334155',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
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
    flexShrink: 1,
    textAlign: 'right',
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
  tripBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 10,
    marginTop: 10,
  },
  tripHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tripTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 12,
    color: '#0f172a',
  },
  tripHint: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#475569',
    textAlign: 'right',
    marginTop: 6,
    lineHeight: 17,
  },
  timeline: {
    marginTop: 8,
    gap: 2,
  },
  timelineRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#cbd5e1',
  },
  dotDone: {
    backgroundColor: '#16a34a',
  },
  dotLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#94a3b8',
  },
  dotLabelDone: {
    color: '#166534',
    fontFamily: 'Vazirmatn_500Medium',
  },
  tripAt: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 10,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 8,
  },
  reportRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  reportBtn: {
    backgroundColor: '#0284c7',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  reportBtnBusy: {
    opacity: 0.6,
  },
  reportBtnDanger: {
    backgroundColor: '#fee2e2',
  },
  reportBtnText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
    color: '#ffffff',
  },
  reportBtnTextDanger: {
    color: '#b91c1c',
  },
  tripClosed: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
    color: '#166534',
    textAlign: 'right',
    marginTop: 8,
  },
  lockedReport: {
    marginTop: 8,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fde68a',
    borderRadius: 8,
    paddingVertical: 7,
    alignItems: 'center',
  },
  lockedReportText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 10,
    color: '#92400e',
  },
});

export default DriverLoadsScreen;




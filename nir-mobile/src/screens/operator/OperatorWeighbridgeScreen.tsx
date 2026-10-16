import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { apiClient } from '../../api/client';
import { Endpoints } from '../../api/endpoints';
import { formatWeight, toPersianDigits } from '../../utils/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  Button,
  Skeleton,
  SkeletonText,
  cn,
} from '../../design-system';

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
}

export function OperatorWeighbridgeScreen() {
  const [directionFilter, setDirectionFilter] = useState<'all' | 'entry' | 'exit'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'netted' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['operator-weighbridge', directionFilter],
    queryFn: async () => {
      const params: Record<string, any> = { limit: 100 };
      if (directionFilter !== 'all') params.direction = directionFilter;
      const res = await apiClient.get(Endpoints.operator.weighbridge, { params });
      return res.data;
    },
  });

  const records: WeighbridgeRecordItem[] = data?.records || [];

  const filteredRecords = records.filter((r) => {
    const isNetted = Number(r.netWeight) > 0;
    if (statusFilter === 'netted' && !isNetted) return false;
    if (statusFilter === 'pending' && isNetted) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const match =
        String(r.ticketNumber || r.externalId).includes(q) ||
        String(r.plateNumber || '').toLowerCase().includes(q) ||
        String(r.driverName || '').toLowerCase().includes(q) ||
        String(r.goods || '').toLowerCase().includes(q) ||
        String(r.customerName || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const renderTicketCard = ({ item }: { item: WeighbridgeRecordItem }) => {
    const isMapped = !!item.mappedRemittanceId;
    const netWeight = Number(item.netWeight) || 0;
    const isNetted = netWeight > 0;
    const isExit = item.direction === 'exit';

    return (
      <Card variant="elevated" size="default" className="mb-3">
        <CardHeader>
          <View className="flex-row justify-between items-center mb-2">
            <View className="flex-row items-center gap-2">
              <Text className="font-vazirmatn text-xs text-mutedForeground">قبض:</Text>
              <Text className="font-vazirmatn text-base font-bold text-foreground">
                {toPersianDigits(item.ticketNumber || item.externalId)}
              </Text>
            </View>
            <Badge
              variant={isMapped ? 'success' : 'warning'}
              size="sm"
            >
              {isMapped ? 'حواله دارد' : 'بدون حواله'}
            </Badge>
          </View>
          <View className="flex-row items-center gap-2 mb-2">
            <View className="bg-emerald-50/50 border border-emerald-200/50 px-2 py-0.5 rounded-full">
              <Text className="font-vazirmatn text-[10px] font-medium text-emerald-700">
                {isExit ? 'خروج' : 'ورود'}
              </Text>
            </View>
          </View>
        </CardHeader>
        <CardContent className="space-y-2">
          <View className="flex-row justify-between items-baseline">
            <Text className="font-vazirmatn text-sm text-mutedForeground">کالا / نهاده:</Text>
            <Text className="font-vazirmatn text-base font-semibold text-foreground">
              {item.goods || 'کالای نامشخص'}
            </Text>
          </View>
          <View className="flex-row justify-between items-baseline p-2 bg-slate-50 rounded-lg border border-border/50">
            <View className="items-end">
              <Text className="font-vazirmatn text-xs text-mutedForeground">وزن ناخالص:</Text>
              <Text className="font-vazirmatn text-base font-bold text-foreground">
                {toPersianDigits(item.grossWeight || 0)}
              </Text>
            </View>
            <View className="items-end">
              <Text className="font-vazirmatn text-xs text-mutedForeground">وزن خالص:</Text>
              <Text className={cn(
                'font-vazirmatn text-base font-bold',
                isNetted ? 'text-emerald-600' : 'text-orange-500'
              )}>
                {toPersianDigits(item.netWeight || 0)}
              </Text>
            </View>
          </View>
          <View className="mt-2 pt-2 border-t border-border/50">
            <Text className="font-vazirmatn text-xs text-mutedForeground text-left">
              زمان 중단: {item.weighTime || '-'}
            </Text>
          </View>
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <ScreenContainer
        title="ثبت وزن باسکول"
        subtitle="مدیریت قبض‌های ورودی و خروجی راننده‌ها"
        scrollable={false}
      >
        <View className="flex-row items-center justify-center h-64">
          <SkeletonText lines={3} className="w-3/4" />
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer
      title="ثبت وزن باسکول"
      subtitle="مدیریت قبض‌های ورودی و خروجی راننده‌ها"
      scrollable={false}
      onRefresh={refetch}
      refreshing={isRefetching}
    >
      <View className="flex-row gap-2 px-4 py-3 bg-surface border-b border-border">
        <TouchableOpacity
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium border',
            directionFilter === 'all'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-surface border-border text-mutedForeground'
          )}
          onPress={() => setDirectionFilter('all')}
        >
          <Text className="font-vazirmatn">همه</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium border',
            directionFilter === 'entry'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-surface border-border text-mutedForeground'
          )}
          onPress={() => setDirectionFilter('entry')}
        >
          <Text className="font-vazirmatn">ورود</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium border',
            directionFilter === 'exit'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-surface border-border text-mutedForeground'
          )}
          onPress={() => setDirectionFilter('exit')}
        >
          <Text className="font-vazirmatn">خروج</Text>
        </TouchableOpacity>
      </View>

      <View className="flex-row gap-2 px-4 py-3 bg-surface border-b border-border">
        <TouchableOpacity
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium border',
            statusFilter === 'all'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-surface border-border text-mutedForeground'
          )}
          onPress={() => setStatusFilter('all')}
        >
          <Text className="font-vazirmatn">همه</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium border',
            statusFilter === 'netted'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-surface border-border text-mutedForeground'
          )}
          onPress={() => setStatusFilter('netted')}
        >
          <Text className="font-vazirmatn">تایید شده</Text>
        </TouchableOpacity>
        <TouchableOpacity
          className={cn(
            'px-3 py-1 rounded-full text-xs font-medium border',
            statusFilter === 'pending'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-surface border-border text-mutedForeground'
          )}
          onPress={() => setStatusFilter('pending')}
        >
          <Text className="font-vazirmatn">در انتظار</Text>
        </TouchableOpacity>
      </View>

      <View className="px-4 pb-2">
        <View className="flex-row items-center gap-2 bg-surface border border-border rounded-lg p-2 mb-4">
          <View className="flex-1">
            <TextInput
              placeholder="جستجو با شماره قبض، پلاک یا نام راننده..."
              placeholderTextColor="#94a3b8"
              value={searchQuery}
              onChangeText={setSearchQuery}
              className="font-vazirmatn text-sm text-foreground"
              style={{ color: '#0f172a' }}
            />
          </View>
          <Button variant="outline" size="sm" className="w-20" onPress={() => refetch()}>
            تازه‌سازی
          </Button>
        </View>
      </View>

      <FlatList
        data={filteredRecords}
        renderItem={renderTicketCard}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View className="items-center p-8">
            <Skeleton className="h-10 w-1/3 rounded-full mb-3 bg-emerald-100" />
            <Text className="font-vazirmatn text-base font-semibold text-foreground mb-1">
              قبضی یافت نشد
            </Text>
            <Text className="font-vazirmatn text-sm text-mutedForeground text-center max-w-xs">
              قبضی با این فیلترها یافت نشد. لطفاً فیلترها یا عبارت جستجو را بررسی کنید.
            </Text>
          </View>
        }
      />
    </ScreenContainer>
  );
}

export default OperatorWeighbridgeScreen;

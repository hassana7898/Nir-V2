import React, { useState } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { OrderFeedModal } from './OrderFeedModal';
import { apiClient } from '../../api/client';
import { Endpoints } from '../../api/endpoints';
import {
  orderStatusLabel,
  orderStatusVariant,
  normalizeOrderRow,
  type FarmerOrder,
  type OrderStatus,
} from '../../features/farmer/farmerOrders';
import { formatWeight, toPersianDigits, formatJalaliDate } from '../../utils/formatters';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  Badge, Button, Skeleton, SkeletonText, cn,
} from '../../design-system';

export function FarmerOrdersScreen() {
  const [modalVisible, setModalVisible] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['farmer-orders', statusFilter],
    queryFn: async () => {
      const params: Record<string, any> = { limit: 50 };
      if (statusFilter !== 'all') params.status = statusFilter;
      const res = await apiClient.get(Endpoints.farmer.orders, { params });
      return res.data;
    },
  });

  const rawOrders = data?.orders || [];
  const orders: FarmerOrder[] = rawOrders.map(normalizeOrderRow);

  const renderOrderCard = ({ item }: { item: FarmerOrder }) => {
    const statusVariant = orderStatusVariant(item.status);
    return (
      <Card variant="elevated" size="default" className="mb-3">
        <CardHeader>
          <View className="flex-row justify-between items-center">
            <View className="items-center">
              <CardTitle className="text-lg">سفارش #{toPersianDigits(item.id)}</CardTitle>
              <CardDescription>
                تاریخ درخواستی: {toPersianDigits(item.targetDate)}
              </CardDescription>
            </View>
            <Badge variant={statusVariant === 'success' ? 'success' : statusVariant === 'danger' ? 'destructive' : statusVariant === 'info' ? 'primary' : 'warning'} size="sm">
              {orderStatusLabel(item.status)}
            </Badge>
          </View>
        </CardHeader>
        <CardContent className="mt-3">
          <View className="flex-row justify-between items-baseline mb-1">
            <Text className="font-vazirmatn text-sm text-mutedForeground">نوع جیره / محصول:</Text>
            <Text className="font-vazirmatn text-base font-semibold text-foreground">{item.productName}</Text>
          </View>
          <View className="flex-row justify-between items-baseline mb-1">
            <Text className="font-vazirmatn text-sm text-mutedForeground">تناژ درخواستی:</Text>
            <Text className="font-vazirmatn text-base font-semibold text-emerald-600">
              {formatWeight(item.requestedWeight)} ({toPersianDigits((item.requestedWeight / 1000).toFixed(1))} تن)
            </Text>
          </View>
          {item.notes && (
            <View className="mt-2">
              <Text className="font-vazirmatn text-xs text-mutedForeground mb-1">توضیحات مرغدار:</Text>
              <Text className="font-vazirmatn text-sm text-foreground">{item.notes}</Text>
            </View>
          )}
          <View className="mt-3 pt-2 border-t border-border/50">
            <Text className="font-vazirmatn text-xs text-mutedForeground text-left">
              ثبت در سامانه: {formatJalaliDate(item.createdAt)}
            </Text>
          </View>
        </CardContent>
        <CardFooter>
          <Button variant="outline" size="sm" className="flex-1" onPress={() => {}}>
            مشاهده جزئیات
          </Button>
        </CardFooter>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <ScreenContainer
        title="سفارش‌های دان من"
        subtitle="رهگیری و پیگیری آنلاین سفارش‌های جیره کارخانه"
        scrollable={false}
      >
        <View className="flex-row items-center justify-center h-64">
          <SkeletonText lines={3} className="w-3/4" />
        </View>
      </ScreenContainer>
    );
  }

  if (isError) {
    return (
      <ScreenContainer
        title="سفارش‌های دان من"
        subtitle="خطا در بارگذاری داده‌ها"
        scrollable={false}
      >
        <View className="items-center p-6">
          <Text className="font-vazirmatn text-lg font-semibold text-destructive mb-2">
            خطا در بارگذاری
          </Text>
          <Text className="font-vazirmatn text-sm text-mutedForeground text-center">
            {error?.message || 'خطای ناشناخته'}
          </Text>
          <Button
            variant="primary"
            className="mt-4 w-48"
            onPress={() => refetch()}
          >
            تلاش مجدد
          </Button>
        </View>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer
      title="سفارش‌های دان من"
      subtitle="رهگیری و پیگیری آنلاین سفارش‌های جیره کارخانه"
      scrollable={false}
      onRefresh={refetch}
      refreshing={isRefetching}
      headerRight={
        <TouchableOpacity onPress={() => setModalVisible(true)}>
          <View className="bg-emerald-600 px-3 py-1.5 rounded-lg items-center">
            <Text className="font-vazirmatn text-xs font-semibold text-white">+ ثبت سفارش</Text>
          </View>
        </TouchableOpacity>
      }
    >
      <View className="flex-row gap-2 px-4 py-3 bg-surface border-b border-border">
        {['all', 'pending', 'approved', 'completed' as const].map((filter) => (
          <TouchableOpacity
            key={filter}
            className={cn(
              'px-3 py-1 rounded-full text-xs font-medium border',
              statusFilter === filter
                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                : 'bg-surface border-border text-mutedForeground'
            )}
            onPress={() => setStatusFilter(filter as OrderStatus)}
          >
            <Text className="font-vazirmatn">
              {filter === 'all' ? 'همه' : filter === 'pending' ? 'در انتظار' : filter === 'approved' ? 'تایید شده' : 'تکمیل شده'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={orders}
        renderItem={renderOrderCard}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View className="items-center p-8">
            <Skeleton className="h-10 w-1/3 rounded-full mb-3 bg-emerald-100" />
            <Text className="font-vazirmatn text-base font-semibold text-foreground mb-1">
              سفارشی یافت نشد
            </Text>
            <Text className="font-vazirmatn text-sm text-mutedForeground text-center max-w-xs">
              شما در این وضعیت هنوز سفارشی ثبت نکرده‌اید. برای ثبت سفارش دان جدید، دکمه «ثبت سفارش» را بزنید.
            </Text>
          </View>
        }
      />

      <OrderFeedModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSuccess={() => refetch()}
      />
    </ScreenContainer>
  );
}

export default FarmerOrdersScreen;

import React, { useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  BackHandler,
} from 'react-native';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { StatusBadge } from '../../components/common/StatusBadge';
import { MetricCard } from '../../components/common/MetricCard';
import {
  formatWeight,
  formatCurrency,
  toPersianDigits,
} from '../../utils/formatters';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
  Badge,
  Button,
  Skeleton,
} from '../../design-system';

export function LoadDetailScreen({ route, navigation }: any) {
  const { load } = route.params || {};

  useEffect(() => {
    const backAction = () => {
      navigation.goBack();
      return true;
    };
    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [navigation]);

  if (!load) {
    return (
      <ScreenContainer showBack onBack={() => navigation.goBack()}>
        <View className="items-center p-6">
          <Text className="font-vazirmatn text-base font-semibold text-destructive text-center mb-2">
            اطلاعات بار یافت نشد.
          </Text>
        </View>
      </ScreenContainer>
    );
  }

  const invoiceNum = load.invoiceNumber || load.remittanceNumber || load.id;
  const isDelivered = load.status === 'delivered';

  return (
    <ScreenContainer
      title={`حواله ${toPersianDigits(invoiceNum)}`}
      showBack
      onBack={() => navigation.goBack()}
    >
      <Card variant="elevated" size="default" className="mb-4">
        <CardHeader className="mb-2">
          <View className="flex-row justify-between items-center">
            <Badge variant={isDelivered ? 'success' : 'primary'} size="sm">
              {load.status}
            </Badge>
            <CardTitle>{load.productName || 'خوراک طیور'}</CardTitle>
          </View>
        </CardHeader>
        <CardContent className="space-y-3">
          <View className="flex-row justify-between items-baseline mb-1">
            <Text className="font-vazirmatn text-sm text-mutedForeground">تحویل‌گیرنده / مرغدار:</Text>
            <Text className="font-vazirmatn text-base font-semibold text-foreground">{load.farmerName || 'نامشخص'}</Text>
          </View>
          <View className="flex-row justify-between items-baseline mb-1">
            <Text className="font-vazirmatn text-sm text-mutedForeground">مبدأ بارگیری:</Text>
            <Text className="font-vazirmatn text-base font-semibold text-foreground">{load.origin || 'کارخانه آرادان'}</Text>
          </View>
          {load.truckNumber && (
            <View className="flex-row justify-between items-baseline p-2 bg-slate-50 rounded-lg border border-border/50">
              <Text className="font-vazirmatn text-sm text-mutedForeground">پلاک خودرو:</Text>
              <Text className="font-vazirmatn text-base font-bold text-foreground tracking-widest">{toPersianDigits(load.truckNumber)}</Text>
            </View>
          )}
        </CardContent>
      </Card>

      <Text className="font-vazirmatn text-sm font-semibold text-foreground text-right mb-2 mt-2">
       اوزان ثبت‌شده باسکول و بارنامه
      </Text>

      <View className="flex-row gap-2 mb-4">
        <Card variant="outline" size="sm" className="flex-1">
          <CardContent className="p-3">
            <Text className="font-vazirmatn text-xs text-mutedForeground">وزن ناخالص (پر)</Text>
            <Text className="font-vazirmatn text-lg font-bold text-foreground">{load.grossWeight || load.weight || 0}</Text>
            <Text className="font-vazirmatn text-xs text-mutedForeground">کیلوگرم</Text>
          </CardContent>
        </Card>
        <Card variant="outline" size="sm" className="flex-1">
          <CardContent className="p-3">
            <Text className="font-vazirmatn text-xs text-mutedForeground">وزن خالی (تار)</Text>
            <Text className="font-vazirmatn text-lg font-bold text-foreground">{load.tareWeight || 0}</Text>
            <Text className="font-vazirmatn text-xs text-mutedForeground">کیلوگرم</Text>
          </CardContent>
        </Card>
      </View>

      <Card variant="elevated" size="sm" className="mb-4 border-l-4 border-l-emerald-500">
        <CardContent className="p-3">
          <View className="flex-row justify-between items-baseline">
            <View>
              <Text className="font-vazirmatn text-xs text-mutedForeground">وزن خالص بارنامه</Text>
              <Text className="font-vazirmatn text-lg font-bold text-emerald-600">{load.weight || load.netWeight || 0}</Text>
              <Text className="font-vazirmatn text-xs text-mutedForeground">کیلوگرم</Text>
            </View>
            <Badge variant="success" size="sm">مبنای فاکتور و تحویل</Badge>
          </View>
        </CardContent>
      </Card>

      {load.transportCost !== undefined && (
        <Card variant="outline" size="default" className="mb-4">
          <CardHeader>
            <CardTitle className="text-sm">اطلاعات کرایه حمل</CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <View className="flex-row justify-between items-baseline mb-1">
              <Text className="font-vazirmatn text-sm text-mutedForeground">کرایه توافقی راننده:</Text>
              <Text className="font-vazirmatn text-base font-bold text-emerald-600">
                {formatCurrency(load.transportCost || 0)}
              </Text>
            </View>
          </CardContent>
        </Card>
      )}

      {!isDelivered ? (
        <Button
          variant="primary"
          size="lg"
          className="w-full mt-2 mb-6"
          onPress={() =>
            navigation.navigate('DeliveryProof', {
              invoiceId: load.id,
              load,
            })
          }
        >
          ثبت رسید و تحویل نهایی بار
        </Button>
      ) : (
        <View className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6">
          <Text className="font-vazirmatn text-sm font-semibold text-emerald-700 text-center">
            این بار با موفقیت تحویل گردیده و رسید آن ثبت شده است.
          </Text>
        </View>
      )}
    </ScreenContainer>
  );
}

export default LoadDetailScreen;

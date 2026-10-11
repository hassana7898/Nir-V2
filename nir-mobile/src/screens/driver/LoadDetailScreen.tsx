import React, { useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
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
        <Text style={styles.errorText}>اطلاعات بار یافت نشد.</Text>
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
      {/* Header Info Card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <StatusBadge status={load.status} />
          <Text style={styles.productTitle}>{load.productName || 'خوراک طیور'}</Text>
        </View>

        <View style={styles.gridRow}>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>تحویل‌گیرنده / مرغدار:</Text>
            <Text style={styles.gridValue}>{load.farmerName || 'نامشخص'}</Text>
          </View>
          <View style={styles.gridItem}>
            <Text style={styles.gridLabel}>مبدأ بارگیری:</Text>
            <Text style={styles.gridValue}>{load.origin || 'کارخانه آرادان'}</Text>
          </View>
        </View>

        {load.truckNumber && (
          <View style={styles.plateBox}>
            <Text style={styles.plateLabel}>پلاک خودرو:</Text>
            <Text style={styles.plateText}>{toPersianDigits(load.truckNumber)}</Text>
          </View>
        )}
      </View>

      {/* Weighbridge Weights Section */}
      <Text style={styles.sectionHeading}>اوزان ثبت‌شده باسکول و بارنامه</Text>

      <View style={styles.metricsRow}>
        <MetricCard
          title="وزن ناخالص (پر)"
          value={load.grossWeight || load.weight || 0}
          unit="کیلوگرم"
          variant="primary"
        />
        <MetricCard
          title="وزن خالی (تار)"
          value={load.tareWeight || 0}
          unit="کیلوگرم"
        />
      </View>

      <MetricCard
        title="وزن خالص بارنامه"
        value={load.weight || load.netWeight || 0}
        unit="کیلوگرم"
        variant="success"
        subtitle="مبنای صدور فاکتور و تحویل نهایی"
      />

      {/* Transport & Financials */}
      {load.transportCost !== undefined && (
        <View style={styles.card}>
          <Text style={styles.cardSectionTitle}>اطلاعات کرایه حمل</Text>
          <View style={styles.financialRow}>
            <Text style={styles.financialLabel}>کرایه توافقی راننده:</Text>
            <Text style={styles.financialValue}>
              {formatCurrency(load.transportCost || 0)}
            </Text>
          </View>
        </View>
      )}

      {/* Primary Action Button */}
      {!isDelivered ? (
        <TouchableOpacity
          style={styles.podButton}
          onPress={() =>
            navigation.navigate('DeliveryProof', {
              invoiceId: load.id,
              load,
            })
          }
        >
          <Text style={styles.podButtonText}>ثبت رسید و تحویل نهایی بار</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.deliveredAlert}>
          <Text style={styles.deliveredAlertText}>
            ✓ این بار با موفقیت تحویل گردیده و رسید آن ثبت شده است.
          </Text>
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardHeader: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
    paddingBottom: 10,
  },
  productTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 16,
    color: '#0f172a',
  },
  gridRow: {
    gap: 8,
  },
  gridItem: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    marginVertical: 2,
  },
  gridLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
  },
  gridValue: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#1e293b',
  },
  plateBox: {
    marginTop: 12,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  plateLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#475569',
  },
  plateText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 15,
    color: '#0f172a',
    letterSpacing: 1,
  },
  sectionHeading: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#1e293b',
    textAlign: 'right',
    marginVertical: 10,
  },
  metricsRow: {
    gap: 4,
  },
  cardSectionTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#334155',
    textAlign: 'right',
    marginBottom: 8,
  },
  financialRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  financialLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
  },
  financialValue: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 15,
    color: '#16a34a',
  },
  podButton: {
    backgroundColor: '#0284c7',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 30,
    shadowColor: '#0284c7',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  podButtonText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 15,
    color: '#ffffff',
  },
  deliveredAlert: {
    backgroundColor: '#dcfce7',
    padding: 14,
    borderRadius: 10,
    marginTop: 10,
    marginBottom: 20,
  },
  deliveredAlertText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#15803d',
    textAlign: 'center',
  },
  errorText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 14,
    color: '#dc2626',
    textAlign: 'center',
    marginTop: 40,
  },
});

export default LoadDetailScreen;

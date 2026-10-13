import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { ImagePickerAction } from '../../components/hardware/ImagePickerAction';
import { SignaturePadModal } from '../../components/hardware/SignaturePadModal';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { apiClient } from '../../api/client';
import { Endpoints } from '../../api/endpoints';
import { extractApiErrorMessage } from '../../api/errors';
import { buildPodRequest, buildQueuedPodPayload } from '../../features/driver/podPayload';
import { toPersianDigits } from '../../utils/formatters';

let Location: any = null;
try {
  Location = require('expo-location');
} catch {
  Location = null;
}

export function DeliveryProofScreen({ route, navigation }: any) {
  const { invoiceId, load } = route.params || {};
  const { isOffline } = useNetworkStatus();
  const { enqueue } = useOfflineQueue();

  const [photoBill, setPhotoBill] = useState<string | null>(null);
  const [photoScale, setPhotoScale] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [signatureModalVisible, setSignatureModalVisible] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(
    null
  );
  const [locating, setLocating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch current GPS coordinates
  useEffect(() => {
    async function getGps() {
      if (!Location) {
        // No location module (headless/test runtime): report "unknown" instead of submitting a
        // fabricated coordinate as proof of delivery.
        setLocation(null);
        return;
      }
      try {
        setLocating(true);
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: 3 });
          setLocation({
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          });
        }
      } catch (err) {
        console.warn('GPS location error:', err);
      } finally {
        setLocating(false);
      }
    }
    getGps();
  }, []);

  const handleSubmitProof = async () => {
    if (!signature) {
      Alert.alert('امضای تحویل‌گیرنده', 'لطفاً امضای مرغدار یا تحویل‌گیرنده بار را اخذ نمایید.');
      return;
    }

    setSubmitting(true);
    const podInput = {
      invoiceId: invoiceId || load?.id,
      photoBillUri: photoBill,
      photoScaleUri: photoScale,
      signatureDataUrl: signature,
      latitude: location?.latitude ?? null,
      longitude: location?.longitude ?? null,
    };

    try {
      if (isOffline) {
        // JSON-safe envelope: inline base64 stays as-is, local photos keep their URIs and are
        // rebuilt as multipart when the queue flushes after reconnection.
        await enqueue({
          endpoint: Endpoints.driver.submitProof,
          method: 'POST',
          payload: buildQueuedPodPayload(podInput) as any,
        });

        Alert.alert(
          'ذخیره در صف آفلاین',
          'رسید تحویل بار به دلیل عدم دسترسی به اینترنت در حافظه دستگاه ذخیره شد و به محض اتصال به شبکه خودکار ارسال می‌گردد.',
          [{ text: 'متوجه شدم', onPress: () => navigation.goBack() }]
        );
      } else {
        const request = buildPodRequest(podInput);
        await apiClient.post(
          request.endpoint,
          request.payload,
          request.headers ? { headers: request.headers } : undefined
        );

        Alert.alert(
          'ثبت موفق رسید',
          'رسید و امضای تحویل بار با موفقیت در سامانه کارخانه ثبت و تایید گردید.',
          [{ text: 'تایید', onPress: () => navigation.goBack() }]
        );
      }
    } catch (err: any) {
      if (!err?.response) {
        // Genuine network outage -> queue it, that is exactly what the queue is for.
        await enqueue({
          endpoint: Endpoints.driver.submitProof,
          method: 'POST',
          payload: buildQueuedPodPayload(podInput) as any,
        });

        Alert.alert(
          'ذخیره در صف آفلاین',
          'ارتباط با سرور برقرار نشد؛ رسید در صف آفلاین دستگاه ذخیره گردید و به زودی ارسال می‌شود.',
          [{ text: 'متوجه شدم', onPress: () => navigation.goBack() }]
        );
      } else {
        // The server answered and rejected the receipt (invalid data, unknown invoice, 5xx…).
        // Queueing it would retry a doomed request forever, so the reason is shown to the driver.
        Alert.alert(
          'خطا در ثبت رسید',
          extractApiErrorMessage(err, 'ثبت رسید تحویل بار با خطا مواجه شد.')
        );
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScreenContainer
      title="رسید تحویل بار (POD)"
      subtitle={`حواله ${toPersianDigits(load?.invoiceNumber || load?.remittanceNumber || invoiceId || '')}`}
      showBack
      onBack={() => navigation.goBack()}
    >
      <View style={styles.card}>
        <Text style={styles.cardTitle}>مستندات و تایید تحویل بار</Text>
        <Text style={styles.cardDesc}>
          لطفاً تصاویر فیزیکی بارنامه، برگه باسکول و امضای تحویل‌گیرنده را ثبت کنید.
        </Text>

        {/* GPS location badge */}
        <View style={styles.gpsRow}>
          <Text style={styles.gpsLabel}>موقعیت جغرافیایی تحویل:</Text>
          {locating ? (
            <ActivityIndicator size="small" color="#0284c7" />
          ) : location ? (
            <Text style={styles.gpsValue}>
              {toPersianDigits(`${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`)} ✓
            </Text>
          ) : (
            <Text style={styles.gpsWarn}>موقعیت در دسترس نیست</Text>
          )}
        </View>

        {/* Images */}
        <ImagePickerAction
          label="تصویر فیزیکی بارنامه امضاشده"
          value={photoBill}
          onChange={setPhotoBill}
        />

        <ImagePickerAction
          label="تصویر برگه باسکول مقصد"
          value={photoScale}
          onChange={setPhotoScale}
        />

        {/* Recipient Signature */}
        <View style={styles.signatureSection}>
          <Text style={styles.signatureLabel}>امضای تحویل‌گیرنده / مرغدار *</Text>
          {signature ? (
            <View style={styles.signaturePreviewBox}>
              <Image source={{ uri: signature }} style={styles.signatureImg} />
              <TouchableOpacity
                style={styles.reSignBtn}
                onPress={() => setSignatureModalVisible(true)}
              >
                <Text style={styles.reSignText}>امضای مجدد</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.openSignBtn}
              onPress={() => setSignatureModalVisible(true)}
            >
              <Text style={styles.openSignText}>لمس جهت اخذ امضای مرغدار</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.btnDisabled]}
          onPress={handleSubmitProof}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.submitButtonText}>
              {isOffline ? 'ذخیره در صف آفلاین' : 'ثبت و تایید نهایی تحویل بار'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <SignaturePadModal
        visible={signatureModalVisible}
        onClose={() => setSignatureModalVisible(false)}
        onSave={setSignature}
      />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cardTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 15,
    color: '#0f172a',
    textAlign: 'right',
  },
  cardDesc: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
    textAlign: 'right',
    marginTop: 4,
    marginBottom: 14,
  },
  gpsRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 10,
    borderRadius: 8,
    marginBottom: 14,
  },
  gpsLabel: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#475569',
  },
  gpsValue: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#16a34a',
  },
  gpsWarn: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#d97706',
  },
  signatureSection: {
    marginTop: 8,
    marginBottom: 16,
  },
  signatureLabel: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#334155',
    textAlign: 'right',
    marginBottom: 6,
  },
  openSignBtn: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#0284c7',
    borderRadius: 10,
    paddingVertical: 18,
    alignItems: 'center',
    backgroundColor: '#f0f9ff',
  },
  openSignText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#0284c7',
  },
  signaturePreviewBox: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    padding: 8,
    backgroundColor: '#ffffff',
    alignItems: 'center',
  },
  signatureImg: {
    width: '100%',
    height: 120,
    resizeMode: 'contain',
  },
  reSignBtn: {
    marginTop: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  reSignText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#0284c7',
  },
  submitButton: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 10,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 15,
    color: '#ffffff',
  },
});

export default DeliveryProofScreen;

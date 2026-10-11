import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { toPersianDigits } from '../../utils/formatters';

export function OtpVerifyScreen({ route, navigation }: any) {
  const { phone, debugCode } = route.params || { phone: '' };
  const { verifyOtp, requestOtp } = useAuth();

  const [code, setCode] = useState(debugCode || '');
  const [timer, setTimer] = useState<number>(120);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setTimer((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleVerify = async () => {
    if (code.length !== 6) {
      setErrorMsg('کد تایید باید ۶ رقمی باشد');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      await verifyOtp(phone, code);
      // Navigation is handled reactively by RootNavigator when isAuthenticated becomes true
    } catch (err: any) {
      setErrorMsg(
        err.response?.data?.message || err.message || 'کد وارد شده نامعتبر یا منقضی است'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true);
    setErrorMsg(null);
    try {
      const res = await requestOtp(phone);
      setTimer(120);
      if (res.debugCode) {
        setCode(res.debugCode);
      }
    } catch (err: any) {
      setErrorMsg('ارسال مجدد پیامک ناموفق بود.');
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <View style={styles.card}>
          <Text style={styles.title}>تایید شماره همراه</Text>
          <Text style={styles.subtitle}>
            کد ۶ رقمی ارسال‌شده به شماره {toPersianDigits(phone)} را وارد نمایید.
          </Text>

          {debugCode && (
            <View style={styles.debugBox}>
              <Text style={styles.debugText}>
                کد تست توسعه: {toPersianDigits(debugCode)}
              </Text>
            </View>
          )}

          <TextInput
            style={styles.otpInput}
            value={code}
            onChangeText={(val) => setCode(val.replace(/[^\d]/g, ''))}
            placeholder="______"
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />

          <TouchableOpacity
            style={[styles.verifyBtn, loading && styles.btnDisabled]}
            onPress={handleVerify}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.verifyText}>ورود به حساب کاربری</Text>
            )}
          </TouchableOpacity>

          {/* Resend & Edit Phone */}
          <View style={styles.footerRow}>
            {timer > 0 ? (
              <Text style={styles.timerText}>
                ارسال مجدد کد پس از {toPersianDigits(formatTimer(timer))}
              </Text>
            ) : (
              <TouchableOpacity onPress={handleResend} disabled={resending}>
                <Text style={styles.resendText}>
                  {resending ? 'در حال ارسال...' : 'ارسال مجدد کد تایید'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
            >
              <Text style={styles.backText}>ویرایش شماره همراه</Text>
            </TouchableOpacity>
          </View>

          {errorMsg && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{errorMsg}</Text>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  container: {
    flex: 1,
    padding: 20,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 3,
  },
  title: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 18,
    color: '#0f172a',
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginVertical: 12,
  },
  debugBox: {
    backgroundColor: '#e0f2fe',
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  debugText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#0369a1',
    textAlign: 'center',
  },
  otpInput: {
    borderWidth: 1.5,
    borderColor: '#0284c7',
    borderRadius: 12,
    paddingVertical: 14,
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 24,
    letterSpacing: 10,
    textAlign: 'center',
    color: '#0f172a',
    backgroundColor: '#f8fafc',
    marginVertical: 14,
  },
  verifyBtn: {
    backgroundColor: '#0284c7',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 6,
  },
  btnDisabled: {
    opacity: 0.7,
  },
  verifyText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 15,
    color: '#ffffff',
  },
  footerRow: {
    marginTop: 18,
    alignItems: 'center',
    gap: 10,
  },
  timerText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#94a3b8',
  },
  resendText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#0284c7',
  },
  backBtn: {
    paddingVertical: 4,
  },
  backText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
  },
  errorBox: {
    marginTop: 14,
    backgroundColor: '#fee2e2',
    padding: 10,
    borderRadius: 8,
  },
  errorText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#b91c1c',
    textAlign: 'center',
  },
});

export default OtpVerifyScreen;

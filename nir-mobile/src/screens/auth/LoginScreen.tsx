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
  ScrollView,
  Modal,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { isValidIranianMobile } from '../../utils/persianText';
import { OfflineStatusBar } from '../../components/common/OfflineStatusBar';
import { getApiBaseUrl, setApiBaseUrl, describeApiTarget } from '../../api/client';
import { extractApiErrorMessage } from '../../api/errors';

export function LoginScreen({ navigation }: any) {
  const { requestOtp, loginWithPassword } = useAuth();

  const [mode, setMode] = useState<'otp' | 'password'>('otp');
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Server settings modal state
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(getApiBaseUrl());
  const [apiTarget, setApiTarget] = useState(describeApiTarget());

  useEffect(() => {
    setCurrentUrl(getApiBaseUrl());
    setApiTarget(describeApiTarget());
  }, []);

  const handleRequestOtp = async () => {
    setErrorMsg(null);
    if (!isValidIranianMobile(phone)) {
      setErrorMsg('شماره تلفن همراه معتبر نیست (مثال: 09123456789)');
      return;
    }

    setLoading(true);
    try {
      const res = await requestOtp(phone);
      // debugCode is present ONLY when the server runs with MOBILE_OTP_DEBUG=true (dev tree);
      // in the production flow the code arrives by SMS and the verification screen starts empty.
      navigation.navigate('OtpVerify', { phone, debugCode: res.debugCode });
    } catch (err: any) {
      setErrorMsg(extractApiErrorMessage(err, 'خطا در ارسال کد تایید پیامکی'));
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordLogin = async () => {
    setErrorMsg(null);
    if (!username.trim() || !password.trim()) {
      setErrorMsg('نام کاربری و کلمه عبور را وارد کنید');
      return;
    }

    setLoading(true);
    try {
      const res = await loginWithPassword(username, password, totpCode || undefined);
      if (res.requires2FA) {
        setRequires2FA(true);
        setErrorMsg('کد احراز هویت دومرحله‌ای (Authenticator) را وارد کنید.');
      }
    } catch (err: any) {
      setErrorMsg(extractApiErrorMessage(err, 'نام کاربری یا کلمه عبور اشتباه است'));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveServerUrl = () => {
    if (!currentUrl.trim()) {
      Alert.alert('خطا', 'آدرس سرور نمی‌تواند خالی باشد');
      return;
    }

    const decision = setApiBaseUrl(currentUrl.trim());
    setShowSettingsModal(false);
    setApiTarget(describeApiTarget());

    if (!decision.allowed) {
      Alert.alert('آدرس رد شد', decision.reason || 'این آدرس برای این نسخه مجاز نیست.');
      return;
    }

    Alert.alert('موفقیت', 'تنظیمات سرور ذخیره شد.');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <OfflineStatusBar />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Top Bar with Server Settings */}
          <View style={styles.topActionRow}>
            <TouchableOpacity
              style={styles.settingsIconBtn}
              onPress={() => setShowSettingsModal(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.gearIcon}>⚙️</Text>
              <Text style={styles.settingsBtnText}>تنظیم سرور / VPS</Text>
            </TouchableOpacity>
          </View>

          {/* Brand Header */}
          <View style={styles.headerBox}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoText}>NIR</Text>
            </View>
            <Text style={styles.appTitle}>سامانه جامع مدیریت کارخانه</Text>
            <Text style={styles.appSubtitle}>
              سامانه حواله، انبار و باسکول خوراک دام و طیور آرادان
            </Text>
          </View>

          {/* Environment banner: which server this build is talking to (there is no offline mode) */}
          <View style={styles.infoBadge}>
            <Text style={styles.infoBadgeText}>{apiTarget}</Text>
          </View>

          {/* Regular Online Login Card */}
          <View style={styles.card}>
            <Text style={styles.cardSectionLabel}>ورود آنلاین متصل به سرور:</Text>
            {/* Mode Switch Tabs */}
            <View style={styles.tabRow}>
              <TouchableOpacity
                style={[styles.tab, mode === 'otp' && styles.tabActive]}
                onPress={() => {
                  setMode('otp');
                  setErrorMsg(null);
                }}
              >
                <Text style={[styles.tabText, mode === 'otp' && styles.tabTextActive]}>
                  راننده / مرغدار (پیامک)
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.tab, mode === 'password' && styles.tabActive]}
                onPress={() => {
                  setMode('password');
                  setErrorMsg(null);
                }}
              >
                <Text style={[styles.tabText, mode === 'password' && styles.tabTextActive]}>
                  مدیر کارخانه
                </Text>
              </TouchableOpacity>
            </View>

            {mode === 'otp' ? (
              <View style={styles.form}>
                <Text style={styles.fieldLabel}>شماره تلفن همراه:</Text>
                <TextInput
                  style={styles.input}
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="09121112233"
                  keyboardType="phone-pad"
                  maxLength={11}
                />
                <Text style={styles.hintText}>
                  کد تایید یکبارمصرف به این شماره پیامک می‌شود؛ شماره باید از قبل در سامانه ثبت شده باشد.
                </Text>

                <TouchableOpacity
                  style={[styles.submitBtn, loading && styles.btnDisabled]}
                  onPress={handleRequestOtp}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.submitText}>دریافت کد ورود پیامکی</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.form}>
                <Text style={styles.fieldLabel}>نام کاربری:</Text>
                <TextInput
                  style={styles.input}
                  value={username}
                  onChangeText={setUsername}
                  placeholder="admin"
                  autoCapitalize="none"
                />

                <Text style={styles.fieldLabel}>کلمه عبور:</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  secureTextEntry
                />

                {requires2FA && (
                  <>
                    <Text style={[styles.fieldLabel, styles.totpLabel]}>
                      کد تایید دو مرحله‌ای (TOTP):
                    </Text>
                    <TextInput
                      style={[styles.input, styles.totpInput]}
                      value={totpCode}
                      onChangeText={setTotpCode}
                      placeholder="123456"
                      keyboardType="number-pad"
                      maxLength={6}
                    />
                  </>
                )}

                <TouchableOpacity
                  style={[styles.submitBtn, loading && styles.btnDisabled]}
                  onPress={handlePasswordLogin}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.submitText}>ورود به پنل مدیریت</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {errorMsg && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* SERVER SETTINGS MODAL */}
      <Modal
        visible={showSettingsModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettingsModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalHeaderIcon}>⚙️</Text>
              <Text style={styles.modalTitle}>تنظیمات اتصال به سرور</Text>
            </View>

            <Text style={styles.modalDesc}>
              می‌توانید آدرس سرور اصلی، سرور توسعه یا سرور مجازی (VPS) اختصاصی خود را وارد کنید:
            </Text>

            <Text style={styles.modalFieldLabel}>آدرس API سرور (Base URL):</Text>
            <TextInput
              style={styles.modalInput}
              value={currentUrl}
              onChangeText={setCurrentUrl}
              placeholder="https://app.artadan.ir یا http://185.x.x.x:3000"
              autoCapitalize="none"
            />

            <View style={styles.quickUrlBox}>
              <Text style={styles.quickUrlLabel}>پیش‌فرض‌ها:</Text>
              <TouchableOpacity
                style={styles.quickUrlBtn}
                onPress={() => setCurrentUrl('https://app.artadan.ir')}
              >
                <Text style={styles.quickUrlText}>سرور اصلی (app.artadan.ir)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickUrlBtn}
                onPress={() => setCurrentUrl('https://dev.artadan.ir')}
              >
                <Text style={styles.quickUrlText}>سرور توسعه (dev.artadan.ir)</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowSettingsModal(false)}
              >
                <Text style={styles.modalCancelText}>انصراف</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalSaveBtn}
                onPress={handleSaveServerUrl}
              >
                <Text style={styles.modalSaveText}>✓ ذخیره و اعمال</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f1f5f9',
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  topActionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    marginBottom: 8,
  },
  settingsIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#e0f2fe',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 6,
  },
  gearIcon: {
    fontSize: 14,
  },
  settingsBtnText: {
    fontSize: 12,
    color: '#0284c7',
    fontWeight: '600',
  },
  headerBox: {
    alignItems: 'center',
    marginVertical: 12,
  },
  logoCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#0284c7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#0284c7',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 4,
  },
  logoText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#ffffff',
    letterSpacing: 2,
  },
  appTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#0f172a',
    textAlign: 'center',
  },
  appSubtitle: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'center',
    marginTop: 4,
  },
  // REGULAR LOGIN CARD
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 2,
  },
  cardSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 10,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '500',
  },
  tabTextActive: {
    color: '#0284c7',
    fontWeight: 'bold',
  },
  form: {
    gap: 10,
  },
  infoBadge: {
    backgroundColor: '#ecfdf5',
    borderWidth: 1,
    borderColor: '#a7f3d0',
    borderRadius: 8,
    padding: 8,
    marginBottom: 6,
  },
  infoBadgeText: {
    fontSize: 11,
    color: '#065f46',
    textAlign: 'center',
    fontWeight: '500',
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
    textAlign: 'right',
  },
  input: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0f172a',
    textAlign: 'right',
  },
  totpLabel: {
    color: '#d97706',
    marginTop: 4,
  },
  totpInput: {
    borderColor: '#f59e0b',
    backgroundColor: '#fffbeb',
    textAlign: 'center',
    letterSpacing: 4,
    fontSize: 18,
  },
  hintText: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'right',
  },
  submitBtn: {
    backgroundColor: '#0284c7',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 6,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  submitText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#ffffff',
  },
  errorBox: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
  },
  errorText: {
    fontSize: 12,
    color: '#b91c1c',
    textAlign: 'center',
  },
  // MODAL STYLES
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  modalHeaderIcon: {
    fontSize: 18,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#0f172a',
  },
  modalDesc: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
    marginBottom: 14,
    textAlign: 'right',
  },
  modalFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
    marginBottom: 6,
    textAlign: 'right',
  },
  modalInput: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    color: '#0f172a',
    textAlign: 'left',
    direction: 'ltr',
    marginBottom: 12,
  },
  quickUrlBox: {
    marginBottom: 16,
    gap: 6,
  },
  quickUrlLabel: {
    fontSize: 11,
    color: '#64748b',
    textAlign: 'right',
    fontWeight: '500',
  },
  quickUrlBtn: {
    backgroundColor: '#f1f5f9',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  quickUrlText: {
    fontSize: 11,
    color: '#0284c7',
    textAlign: 'center',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
  },
  modalCancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  modalCancelText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '600',
  },
  modalSaveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: '#0284c7',
  },
  modalSaveText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: '#ffffff',
  },
});

export default LoginScreen;

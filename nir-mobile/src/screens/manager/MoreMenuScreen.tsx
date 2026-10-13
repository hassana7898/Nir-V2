import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { ScreenContainer } from '../../components/common/ScreenContainer';
import { useAuth } from '../../hooks/useAuth';
import { getApiBaseUrl, setApiBaseUrl, describeApiTarget } from '../../api/client';

export function MoreMenuScreen({ navigation }: any) {
  const { user, logout } = useAuth();
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());

  const handleLogout = () => {
    Alert.alert(
      'خروج از حساب',
      'آیا از خروج از حساب کاربری مدیر اطمینان دارید؟',
      [
        { text: 'انصراف', style: 'cancel' },
        { text: 'خروج', style: 'destructive', onPress: () => logout() },
      ]
    );
  };

  const handleSaveServer = () => {
    if (!serverUrl.trim()) {
      Alert.alert('خطا', 'آدرس سرور نمی‌تواند خالی باشد');
      return;
    }

    const decision = setApiBaseUrl(serverUrl.trim());
    setShowServerModal(false);

    if (!decision.allowed) {
      Alert.alert('آدرس رد شد', decision.reason || 'این آدرس برای این نسخه مجاز نیست.');
      return;
    }

    Alert.alert('موفقیت', 'آدرس سرور با موفقیت به‌روزرسانی شد.');
  };

  return (
    <ScreenContainer title="امکانات و بخش‌های تکمیلی" subtitle="دسترسی به کلیه ماژول‌های سامانه کارخانه آرادان">
      <ScrollView contentContainerStyle={styles.scroll}>
        {/* User Card */}
        <View style={styles.userCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>مدیر</Text>
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user?.fullName || 'کاربر سامانه'}</Text>
            <Text style={styles.userRole}>
              {user?.role === 'ADMIN'
                ? 'مدیر ارشد سامانه'
                : user?.role === 'MANAGER'
                ? 'مدیر کارخانه خوراک دام و طیور آرادان'
                : 'کاربر سامانه'}
            </Text>
            <Text style={styles.userPhone}>شماره تماس: {user?.phone || '—'}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>ماژول‌های اختصاصی سامانه NIR:</Text>

        {/* Action Buttons Grid */}
        <View style={styles.menuGrid}>
          {/* Farmers Directory */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('FarmersDirectory')}
            activeOpacity={0.7}
          >
            <Text style={styles.menuIcon}>🌾</Text>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>مرغداران و دوره‌های پرورش</Text>
              <Text style={styles.menuDesc}>مشاهده فهرست مرغداران، دوره‌ها، سن گله و سوابق خرید دان</Text>
            </View>
            <Text style={styles.chevron}>‹</Text>
          </TouchableOpacity>

          {/* راننده‌های نامطابق (Phase 2, G-7): read-only report the office works from */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('UnmatchedDrivers')}
            activeOpacity={0.7}
          >
            <Text style={styles.menuIcon}>🧩</Text>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>راننده‌های نامطابق</Text>
              <Text style={styles.menuDesc}>
                حواله‌هایی که نام راننده دارند اما به پرونده راننده وصل نشده‌اند
              </Text>
            </View>
            <Text style={styles.chevron}>‹</Text>
          </TouchableOpacity>

          {/* Approvals Cartable */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => navigation.navigate('Approvals')}
            activeOpacity={0.7}
          >
            <Text style={styles.menuIcon}>✅</Text>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>کارتابل تاییدات و بازرسی</Text>
              <Text style={styles.menuDesc}>تایید سفارشات دان مرغداران و بررسی امضا و بارنامه رانندگان</Text>
            </View>
            <Text style={styles.chevron}>‹</Text>
          </TouchableOpacity>

          {/* Server / VPS Settings */}
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => setShowServerModal(true)}
            activeOpacity={0.7}
          >
            <Text style={styles.menuIcon}>⚙️</Text>
            <View style={styles.menuTextWrap}>
              <Text style={styles.menuTitle}>تنظیمات اتصال سرور / VPS</Text>
              <Text style={styles.menuDesc}>تغییر آدرس سرور اصلی، سرور مجازی و تست ارتباط شبکه</Text>
            </View>
            <Text style={styles.chevron}>‹</Text>
          </TouchableOpacity>

          {/* Logout */}
          <TouchableOpacity
            style={[styles.menuItem, styles.logoutItem]}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <Text style={styles.menuIcon}>🚪</Text>
            <View style={styles.menuTextWrap}>
              <Text style={[styles.menuTitle, styles.logoutText]}>خروج از حساب کاربری</Text>
              <Text style={styles.menuDesc}>خاتمه نشست فعال و بازگشت به صفحه ورود</Text>
            </View>
            <Text style={styles.chevron}>‹</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* SERVER MODAL */}
      <Modal visible={showServerModal} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>تنظیمات آدرس سرور (Base URL)</Text>
            <Text style={styles.modalDesc}>
              آدرس سرور مجازی (VPS) یا سرور توسعه را وارد کنید:
            </Text>

            <Text style={styles.modalDesc}>اتصال فعلی: {describeApiTarget()}</Text>

            <TextInput
              style={styles.modalInput}
              value={serverUrl}
              onChangeText={setServerUrl}
              placeholder="https://dev.artadan.ir"
              autoCapitalize="none"
            />

            <View style={styles.quickBox}>
              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => setServerUrl('https://dev.artadan.ir')}
              >
                <Text style={styles.quickText}>سرور توسعه (dev.artadan.ir)</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.quickBtn}
                onPress={() => setServerUrl('https://app.artadan.ir')}
              >
                <Text style={styles.quickText}>سرور اصلی (app.artadan.ir)</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setShowServerModal(false)}
              >
                <Text style={styles.cancelText}>انصراف</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSaveServer}>
                <Text style={styles.saveText}>ذخیره و اعمال</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingBottom: 40,
  },
  userCard: {
    flexDirection: 'row-reverse',
    backgroundColor: '#0284c7',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    alignItems: 'center',
    gap: 12,
  },
  avatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#38bdf8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
  },
  userInfo: {
    flex: 1,
    alignItems: 'flex-end',
  },
  userName: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 16,
    color: '#ffffff',
  },
  userRole: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#bae6fd',
    marginTop: 2,
  },
  userPhone: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#e0f2fe',
    marginTop: 2,
  },
  sectionTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#334155',
    marginBottom: 12,
    textAlign: 'right',
  },
  menuGrid: {
    gap: 10,
  },
  menuItem: {
    flexDirection: 'row-reverse',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  menuIcon: {
    fontSize: 24,
    marginLeft: 12,
  },
  menuTextWrap: {
    flex: 1,
    alignItems: 'flex-end',
  },
  menuTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 14,
    color: '#0f172a',
  },
  menuDesc: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    textAlign: 'right',
  },
  chevron: {
    fontSize: 22,
    color: '#94a3b8',
    marginRight: 6,
  },
  logoutItem: {
    borderColor: '#fee2e2',
    backgroundColor: '#fef2f2',
    marginTop: 10,
  },
  logoutText: {
    color: '#b91c1c',
  },
  // MODAL
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
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
  },
  modalTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 15,
    color: '#0f172a',
    textAlign: 'right',
    marginBottom: 8,
  },
  modalDesc: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
    textAlign: 'right',
    marginBottom: 12,
  },
  modalInput: {
    fontFamily: 'Vazirmatn_400Regular',
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 13,
    color: '#0f172a',
    marginBottom: 12,
    textAlign: 'left',
  },
  quickBox: {
    gap: 6,
    marginBottom: 16,
  },
  quickBtn: {
    backgroundColor: '#f1f5f9',
    paddingVertical: 7,
    borderRadius: 6,
    alignItems: 'center',
  },
  quickText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#0284c7',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelText: {
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
  saveText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 13,
    color: '#ffffff',
  },
});

export default MoreMenuScreen;

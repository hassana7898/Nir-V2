import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../hooks/useAuth';
import { OfflineStatusBar } from './OfflineStatusBar';
import { toPersianDigits } from '../../utils/formatters';

interface ScreenContainerProps {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  scrollable?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  showBack?: boolean;
  onBack?: () => void;
  headerRight?: React.ReactNode;
}

export function ScreenContainer({
  title,
  subtitle,
  children,
  scrollable = true,
  refreshing = false,
  onRefresh,
  showBack = false,
  onBack,
  headerRight,
}: ScreenContainerProps) {
  const { user, role, logout } = useAuth();

  const roleTitle =
    role === 'DRIVER'
      ? 'راننده'
      : role === 'FARMER'
      ? 'مرغدار'
      : role === 'ADMIN'
      ? 'مدیر ارشد'
      : 'مدیر کارخانه';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      <OfflineStatusBar />

      {/* Top Navigation Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {showBack ? (
            <TouchableOpacity style={styles.backButton} onPress={onBack}>
              <Text style={styles.backText}>بازگشت</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.userBadge}>
              <Text style={styles.userName}>{user?.fullName || user?.username || 'کاربر'}</Text>
              <Text style={styles.userRole}>({roleTitle})</Text>
            </View>
          )}
        </View>

        <View style={styles.headerCenter}>
          {title && <Text style={styles.headerTitle}>{title}</Text>}
          {subtitle && <Text style={styles.headerSubtitle}>{subtitle}</Text>}
        </View>

        <View style={styles.headerRight}>
          {headerRight ? (
            headerRight
          ) : (
            <TouchableOpacity style={styles.logoutBtn} onPress={() => logout()}>
              <Text style={styles.logoutText}>خروج</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Main Body */}
      {scrollable ? (
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={['#0284c7']}
              />
            ) : undefined
          }
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.staticContent]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  header: {
    height: 56,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  headerLeft: {
    flex: 1,
    alignItems: 'flex-end',
  },
  headerCenter: {
    flex: 2,
    alignItems: 'center',
  },
  headerRight: {
    flex: 1,
    alignItems: 'flex-start',
  },
  headerTitle: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 16,
    color: '#0f172a',
  },
  headerSubtitle: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
  },
  userBadge: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 4,
  },
  userName: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#1e293b',
  },
  userRole: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#0284c7',
  },
  backButton: {
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  backText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#334155',
  },
  logoutBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#fee2e2',
  },
  logoutText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
    color: '#dc2626',
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 14,
  },
  staticContent: {
    padding: 14,
  },
});

export default ScreenContainer;

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { useOfflineQueue } from '../../hooks/useOfflineQueue';
import { toPersianDigits } from '../../utils/formatters';

export function OfflineStatusBar() {
  const { isOffline } = useNetworkStatus();
  const { pendingCount, isFlushing, flush } = useOfflineQueue();

  if (!isOffline && pendingCount === 0) {
    return null;
  }

  return (
    <View style={[styles.container, isOffline ? styles.offlineBg : styles.syncBg]}>
      <View style={styles.textRow}>
        {isFlushing ? (
          <ActivityIndicator size="small" color="#92400e" style={styles.spinner} />
        ) : (
          <View style={[styles.dot, isOffline ? styles.dotOffline : styles.dotPending]} />
        )}
        <Text style={styles.text}>
          {isOffline
            ? `حالت آفلاین — ${pendingCount > 0 ? `${toPersianDigits(pendingCount)} عملیات در صف محلی` : 'تغییرات محلی ذخیره می‌شوند'}`
            : isFlushing
            ? 'در حال همگام‌سازی عملیات صف با سرور...'
            : `${toPersianDigits(pendingCount)} عملیات آماده ارسال به سرور`}
        </Text>
      </View>
      {!isOffline && !isFlushing && pendingCount > 0 && (
        <TouchableOpacity style={styles.flushButton} onPress={() => flush()}>
          <Text style={styles.flushText}>ارسال آنی</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 999,
  },
  offlineBg: {
    backgroundColor: '#fee2e2',
    borderBottomWidth: 1,
    borderBottomColor: '#fecaca',
  },
  syncBg: {
    backgroundColor: '#fef3c7',
    borderBottomWidth: 1,
    borderBottomColor: '#fde68a',
  },
  textRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    flex: 1,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 8,
  },
  dotOffline: {
    backgroundColor: '#ef4444',
  },
  dotPending: {
    backgroundColor: '#f59e0b',
  },
  spinner: {
    marginLeft: 8,
  },
  text: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#7f1d1d',
    textAlign: 'right',
  },
  flushButton: {
    backgroundColor: '#d97706',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  flushText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 11,
    color: '#ffffff',
  },
});

export default OfflineStatusBar;

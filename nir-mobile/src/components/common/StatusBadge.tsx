import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export type StatusVariant =
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'pending'
  | 'in_transit'
  | 'delivered'
  | 'mismatch'
  | 'done';

interface StatusBadgeProps {
  status: StatusVariant | string;
  label?: string;
  size?: 'sm' | 'md';
}

const statusLabels: Record<string, string> = {
  success: 'موفق',
  done: 'انجام شد',
  delivered: 'تحویل شد',
  warning: 'در انتظار',
  pending: 'در حال بررسی',
  in_transit: 'در مسیر',
  error: 'خطا',
  mismatch: '⚠ مغایرت',
  info: 'اطلاعیه',
};

export function StatusBadge({ status, label, size = 'md' }: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase();

  let bg = '#f1f5f9';
  let text = '#475569';

  if (['success', 'delivered', 'done', 'approved', 'completed'].includes(normalizedStatus)) {
    bg = '#dcfce7';
    text = '#166534';
  } else if (['warning', 'pending', 'in_transit'].includes(normalizedStatus)) {
    bg = '#fef3c7';
    text = '#92400e';
  } else if (['error', 'mismatch', 'rejected'].includes(normalizedStatus)) {
    bg = '#fee2e2';
    text = '#991b1b';
  } else if (['info'].includes(normalizedStatus)) {
    bg = '#e0f2fe';
    text = '#075985';
  }

  const displayText = label || statusLabels[normalizedStatus] || status;

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: bg },
        size === 'sm' ? styles.badgeSm : styles.badgeMd,
      ]}
    >
      <Text
        style={[
          styles.text,
          { color: text },
          size === 'sm' ? styles.textSm : styles.textMd,
        ]}
      >
        {displayText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeMd: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  text: {
    fontFamily: 'Vazirmatn_500Medium',
  },
  textSm: {
    fontSize: 10,
  },
  textMd: {
    fontSize: 12,
  },
});

export default StatusBadge;

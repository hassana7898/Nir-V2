import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { toPersianDigits, formatNumberWithCommas } from '../../utils/formatters';

interface MetricCardProps {
  title: string;
  value: number | string;
  unit?: string;
  subtitle?: string;
  trend?: string;
  trendPositive?: boolean;
  icon?: React.ReactNode;
  variant?: 'default' | 'primary' | 'warning' | 'danger' | 'success';
}

export function MetricCard({
  title,
  value,
  unit,
  subtitle,
  trend,
  trendPositive,
  icon,
  variant = 'default',
}: MetricCardProps) {
  const formattedValue =
    typeof value === 'number'
      ? toPersianDigits(formatNumberWithCommas(value))
      : toPersianDigits(value);

  let borderRightColor = '#e2e8f0';
  if (variant === 'primary') borderRightColor = '#0284c7';
  if (variant === 'success') borderRightColor = '#16a34a';
  if (variant === 'warning') borderRightColor = '#d97706';
  if (variant === 'danger') borderRightColor = '#dc2626';

  return (
    <View style={[styles.card, { borderRightColor }]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        {icon && <View style={styles.iconContainer}>{icon}</View>}
      </View>

      <View style={styles.valueRow}>
        <Text style={styles.value}>{formattedValue}</Text>
        {unit && <Text style={styles.unit}>{unit}</Text>}
      </View>

      <View style={styles.footerRow}>
        {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        {trend && (
          <View
            style={[
              styles.trendBadge,
              trendPositive ? styles.trendPos : styles.trendNeg,
            ]}
          >
            <Text
              style={[
                styles.trendText,
                trendPositive ? styles.trendTextPos : styles.trendTextNeg,
              ]}
            >
              {toPersianDigits(trend)}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderRightWidth: 4,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  headerRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#64748b',
    textAlign: 'right',
  },
  iconContainer: {
    padding: 4,
  },
  valueRow: {
    flexDirection: 'row-reverse',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  value: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 22,
    color: '#0f172a',
    textAlign: 'right',
  },
  unit: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#64748b',
    marginRight: 6,
  },
  footerRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subtitle: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 11,
    color: '#94a3b8',
    textAlign: 'right',
  },
  trendBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  trendPos: {
    backgroundColor: '#dcfce7',
  },
  trendNeg: {
    backgroundColor: '#fee2e2',
  },
  trendText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 10,
  },
  trendTextPos: {
    color: '#15803d',
  },
  trendTextNeg: {
    color: '#b91c1c',
  },
});

export default MetricCard;

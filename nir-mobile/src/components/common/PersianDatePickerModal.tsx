import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { toJalali, jalaliText } from '../../utils/jalali';
import { toPersianDigits } from '../../utils/formatters';

interface PersianDatePickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (jalaliDate: string) => void;
  initialDate?: string;
}

const PERSIAN_MONTHS = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

export function PersianDatePickerModal({
  visible,
  onClose,
  onSelect,
  initialDate,
}: PersianDatePickerModalProps) {
  const today = toJalali(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    new Date().getDate()
  );

  let initYear = today.jy;
  let initMonth = today.jm;
  let initDay = today.jd;

  if (initialDate && initialDate.includes('/')) {
    const parts = initialDate.split('/').map((p) => parseInt(p, 10));
    if (parts.length === 3 && !isNaN(parts[0])) {
      initYear = parts[0];
      initMonth = parts[1];
      initDay = parts[2];
    }
  }

  const [selectedYear, setSelectedYear] = useState<number>(initYear);
  const [selectedMonth, setSelectedMonth] = useState<number>(initMonth);
  const [selectedDay, setSelectedDay] = useState<number>(initDay);

  const daysInMonth = selectedMonth <= 6 ? 31 : selectedMonth <= 11 ? 30 : 29;
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const handleConfirm = () => {
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    const result = `${selectedYear}/${pad(selectedMonth)}/${pad(selectedDay)}`;
    onSelect(result);
    onClose();
  };

  const handleSelectToday = () => {
    setSelectedYear(today.jy);
    setSelectedMonth(today.jm);
    setSelectedDay(today.jd);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContainer}>
          <Text style={styles.title}>انتخاب تاریخ شمسی</Text>

          {/* Current Selection Preview */}
          <View style={styles.previewBox}>
            <Text style={styles.previewText}>
              {toPersianDigits(
                `${selectedDay} ${PERSIAN_MONTHS[selectedMonth - 1]} ${selectedYear}`
              )}
            </Text>
          </View>

          {/* Month selector row */}
          <Text style={styles.sectionLabel}>ماه:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.monthsRow}
          >
            {PERSIAN_MONTHS.map((m, idx) => {
              const monthNum = idx + 1;
              const isSelected = selectedMonth === monthNum;
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.monthPill, isSelected && styles.monthPillActive]}
                  onPress={() => setSelectedMonth(monthNum)}
                >
                  <Text style={[styles.monthText, isSelected && styles.monthTextActive]}>
                    {m}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Day Grid */}
          <Text style={styles.sectionLabel}>روز:</Text>
          <View style={styles.daysGrid}>
            {daysArray.map((d) => {
              const isSelected = selectedDay === d;
              return (
                <TouchableOpacity
                  key={d}
                  style={[styles.dayCell, isSelected && styles.dayCellActive]}
                  onPress={() => setSelectedDay(d)}
                >
                  <Text style={[styles.dayText, isSelected && styles.dayTextActive]}>
                    {toPersianDigits(d)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Actions */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.todayButton} onPress={handleSelectToday}>
              <Text style={styles.todayText}>امروز</Text>
            </TouchableOpacity>

            <View style={styles.mainActions}>
              <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
                <Text style={styles.cancelText}>انصراف</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm}>
                <Text style={styles.confirmText}>تایید تاریخ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContainer: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
    width: '100%',
    maxWidth: 380,
  },
  title: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 16,
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 10,
  },
  previewBox: {
    backgroundColor: '#f0f9ff',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  previewText: {
    fontFamily: 'Vazirmatn_700Bold',
    fontSize: 15,
    color: '#0284c7',
  },
  sectionLabel: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#64748b',
    textAlign: 'right',
    marginBottom: 6,
  },
  monthsRow: {
    flexDirection: 'row-reverse',
    paddingBottom: 10,
    gap: 6,
  },
  monthPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  monthPillActive: {
    backgroundColor: '#0284c7',
  },
  monthText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 12,
    color: '#334155',
  },
  monthTextActive: {
    color: '#ffffff',
    fontFamily: 'Vazirmatn_500Medium',
  },
  daysGrid: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginBottom: 16,
  },
  dayCell: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#f8fafc',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  dayCellActive: {
    backgroundColor: '#0284c7',
    borderColor: '#0284c7',
  },
  dayText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 13,
    color: '#1e293b',
  },
  dayTextActive: {
    color: '#ffffff',
  },
  actionRow: {
    flexDirection: 'row-reverse',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f5f9',
    paddingTop: 12,
  },
  todayButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  todayText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#0284c7',
  },
  mainActions: {
    flexDirection: 'row-reverse',
    gap: 8,
  },
  cancelButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  cancelText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#64748b',
  },
  confirmButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#0284c7',
  },
  confirmText: {
    fontFamily: 'Vazirmatn_500Medium',
    fontSize: 12,
    color: '#ffffff',
  },
});

export default PersianDatePickerModal;

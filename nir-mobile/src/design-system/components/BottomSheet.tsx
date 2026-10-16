/**
 * BottomSheet - شیت پایین‌رفته (منuciones، فیلتر، جزئیات سفارش)
 * backdrop pół-transparent + shown از پایین
 * RTL-aware و Vazirmatn
 */

import React, { useState, useEffect } from 'react';
import {
  Animated,
  Dimensions,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  ViewStyle,
} from 'react-native';
import { cn } from '../utils/cn';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  snapPoints?: number[]; // divisors of screen height (e.g. [2, 3, 4])
  handleColor?: string;
  className?: string;
  backdropClassName?: string;
}

export const BottomSheet = ({
  isOpen,
  onClose,
  children,
  snapPoints = [2, 3, 4],
  handleColor = '#94a3b8',
  className,
  backdropClassName,
}: BottomSheetProps) => {
  const [currentSnapIndex, setCurrentSnapIndex] = useState<number>(0);
  const panY = new Animated.Value(0);

  useEffect(() => {
    if (isOpen) {
      const snap = snapPoints[currentSnapIndex] || snapPoints[0];
      Animated.timing(panY, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(panY, {
        toValue: SCREEN_HEIGHT,
        duration: 250,
        useNativeDriver: true,
      }).start();
    }
  }, [isOpen, panY, currentSnapIndex, snapPoints]);

  const translateY = panY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SCREEN_HEIGHT],
  });

  const containerStyle: ViewStyle = {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 12,
    transform: [{ translateY }],
  };

  const backdropStyle: ViewStyle = {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    zIndex: 1000,
  };

  if (!isOpen) return null;

  return (
    <View style={StyleSheet.absoluteFill}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={[backdropStyle, StyleSheet.flatten([backdropClassName as unknown as ViewStyle])]} />
      </TouchableWithoutFeedback>
      <Animated.View
        style={[containerStyle, StyleSheet.flatten([className as unknown as ViewStyle])]}
      >
        {/* Drag handle */}
        <View
          style={{
            alignSelf: 'center',
            marginTop: 8,
            width: 40,
            height: 5,
            backgroundColor: handleColor,
            borderRadius: 4,
          }}
        />
        {children}
      </Animated.View>
    </View>
  );
};
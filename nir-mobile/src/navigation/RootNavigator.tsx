import React, { useEffect } from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { AuthNavigator } from './AuthNavigator';
import { DriverNavigator } from './DriverNavigator';
import { FarmerNavigator } from './FarmerNavigator';
import { ManagerNavigator } from './ManagerNavigator';
import { registerForPushNotificationsAsync } from '../services/notificationService';
import { describeApiTarget } from '../api/client';
import type { UserRole } from '../types/auth';

/**
 * Role-based navigation resolution. Any authenticated user whose role the server did not issue
 * (unknown string, missing role) lands on the Auth navigator again instead of being dropped into a
 * role-specific UI it has no rights for — the previous fallback silently opened the driver app.
 */
export function resolveTargetNavigator(
  isAuthenticated: boolean,
  role: UserRole | null
): 'AuthNavigator' | 'DriverNavigator' | 'FarmerNavigator' | 'ManagerNavigator' {
  if (!isAuthenticated) return 'AuthNavigator';
  if (role === 'DRIVER') return 'DriverNavigator';
  if (role === 'FARMER') return 'FarmerNavigator';
  if (role === 'MANAGER' || role === 'ADMIN') return 'ManagerNavigator';
  return 'AuthNavigator';
}

export function RootNavigator() {
  const { isLoading, isAuthenticated, role } = useAuth();

  // One line in the device log that answers "which server / which build is this?" during testing.
  useEffect(() => {
    console.log(`[NIR Navigator] API target: ${describeApiTarget()}`);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      try {
        registerForPushNotificationsAsync().catch(() => {});
      } catch {
        // Ignore native push errors in unconfigured environments
      }
    }
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={styles.loadingText}>در حال بارگذاری سامانه NIR...</Text>
      </View>
    );
  }

  const target = resolveTargetNavigator(isAuthenticated, role);

  return (
    <NavigationContainer>
      {target === 'AuthNavigator' ? (
        <AuthNavigator />
      ) : target === 'DriverNavigator' ? (
        <DriverNavigator />
      ) : target === 'FarmerNavigator' ? (
        <FarmerNavigator />
      ) : (
        <ManagerNavigator />
      )}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
  },
  loadingText: {
    fontFamily: 'Vazirmatn_400Regular',
    fontSize: 13,
    color: '#64748b',
    marginTop: 12,
  },
});

export default RootNavigator;

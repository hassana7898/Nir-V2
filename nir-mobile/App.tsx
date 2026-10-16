import React, { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity, I18nManager } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  useFonts,
  Vazirmatn_400Regular,
  Vazirmatn_500Medium,
  Vazirmatn_700Bold,
} from '@expo-google-fonts/vazirmatn';

import { setupRTL } from './src/design-system/theme/rtl';
import { AuthProvider } from './src/contexts/AuthContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { initOfflineQueueAutoSync } from './src/services/offlineQueue';
import {
  UiPreviewApp,
  isUiPreviewEnabled,
  installPreviewNetwork,
} from './src/dev/UiPreviewApp';

// Enable RTL for the entire app (Persian / Arabic layout)
setupRTL();
I18nManager.allowRTL(true);

// Root Error Boundary to eliminate silent white screens
interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class RootErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[RootErrorBoundary caught error]:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>خطا در بارگذاری سامانه NIR</Text>
          <Text style={styles.errorSubtitle}>
            سامانه با خطای سیستمی مواجه شد:
          </Text>
          <View style={styles.errorDetailsBox}>
            <Text style={styles.errorDetailsText}>
              {this.state.error?.message || 'خطای ناشناخته در زمان اجرا'}
            </Text>
          </View>
          <TouchableOpacity style={styles.reloadBtn} onPress={this.handleReload}>
            <Text style={styles.reloadBtnText}>تلاش مجدد و بارگذاری</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 2,
    },
  },
});

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Vazirmatn_400Regular,
    Vazirmatn_500Medium,
    Vazirmatn_700Bold,
  });

  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    // Safety guard: Never block rendering for more than 800ms
    const timer = setTimeout(() => {
      setTimedOut(true);
    }, 800);

    // Start background auto-sync listener safely
    let unsubscribe = () => {};
    try {
      unsubscribe = initOfflineQueueAutoSync();
    } catch (e) {
      console.warn('[App] Auto-sync init error:', e);
    }

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const isReady = fontsLoaded || fontError || timedOut;

  // Design-review harness. Mounted only when `EXPO_PUBLIC_UI_PREVIEW=1` AND the bundle is a dev
  // build; both are compile-time constants, so a production bundle never enters this branch. It is
  // checked before the normal tree so the reviewer gets the redesigned screens instead of a login
  // gate, and it bypasses AuthContext only because it supplies fixture transport.
  if (isUiPreviewEnabled && isReady) {
    installPreviewNetwork();
    return <UiPreviewApp />;
  }

  if (!isReady) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#0284c7" />
        <Text style={styles.loadingText}>در حال راه‌اندازی سامانه NIR...</Text>
      </View>
    );
  }

  return (
    <RootErrorBoundary>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </RootErrorBoundary>
  );
}

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    gap: 12,
  },
  loadingText: {
    fontSize: 13,
    color: '#64748b',
    fontWeight: '500',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8fafc',
    padding: 24,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#b91c1c',
    marginBottom: 8,
  },
  errorSubtitle: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 16,
    textAlign: 'center',
  },
  errorDetailsBox: {
    backgroundColor: '#fee2e2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 8,
    padding: 12,
    width: '100%',
    marginBottom: 20,
  },
  errorDetailsText: {
    fontSize: 12,
    color: '#991b1b',
    textAlign: 'center',
  },
  reloadBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  reloadBtnText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 'bold',
  },
});
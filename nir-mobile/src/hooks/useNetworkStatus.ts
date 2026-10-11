/**
 * Network Connectivity Hook for NIR Mobile.
 */

import { useState, useEffect } from 'react';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

export interface UseNetworkStatusResult {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  isOffline: boolean;
}

export function useNetworkStatus(): UseNetworkStatusResult {
  const [networkState, setNetworkState] = useState<{
    isConnected: boolean;
    isInternetReachable: boolean | null;
  }>({
    isConnected: true,
    isInternetReachable: true,
  });

  useEffect(() => {
    NetInfo.fetch().then((state: NetInfoState) => {
      setNetworkState({
        isConnected: state.isConnected ?? true,
        isInternetReachable: state.isInternetReachable ?? null,
      });
    });

    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      setNetworkState({
        isConnected: state.isConnected ?? true,
        isInternetReachable: state.isInternetReachable ?? null,
      });
    });

    return () => unsubscribe();
  }, []);

  const isOffline = !networkState.isConnected || networkState.isInternetReachable === false;

  return {
    isConnected: networkState.isConnected,
    isInternetReachable: networkState.isInternetReachable,
    isOffline,
  };
}

export default useNetworkStatus;

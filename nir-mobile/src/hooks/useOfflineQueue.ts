/**
 * Offline Queue Hook for components.
 * Enables queuing weight receipts, load status transitions, and orders
 * during network dropouts, with automatic background synchronization.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  enqueueMutation,
  flushOfflineQueue,
  clearOfflineQueue,
  getOfflineQueue,
  getPendingMutationCount,
  getDeadLetters,
  clearDeadLetters,
  onQueueStatusChange,
} from '../services/offlineQueue';
import type { OfflineMutation, DeadLetterItem } from '../types/offline';

export function useOfflineQueue() {
  const [queue, setQueue] = useState<OfflineMutation[]>(getOfflineQueue());
  const [pendingCount, setPendingCount] = useState<number>(getPendingMutationCount());
  const [isFlushing, setIsFlushing] = useState<boolean>(false);
  const [deadLetters, setDeadLetters] = useState<DeadLetterItem[]>(getDeadLetters());

  const refreshState = useCallback(() => {
    setQueue(getOfflineQueue());
    setPendingCount(getPendingMutationCount());
    setDeadLetters(getDeadLetters());
  }, []);

  useEffect(() => {
    refreshState();

    const unsubscribe = onQueueStatusChange((status) => {
      setPendingCount(status.pendingCount);
      setIsFlushing(status.isFlushing);
      setQueue(getOfflineQueue());
      setDeadLetters(getDeadLetters());
    });

    return () => unsubscribe();
  }, [refreshState]);

  const enqueue = useCallback(
    async <T = any>(
      params: Omit<OfflineMutation<T>, 'id' | 'createdAt' | 'retryCount'>
    ) => {
      const item = await enqueueMutation(params);
      refreshState();
      return item;
    },
    [refreshState]
  );

  const flush = useCallback(async () => {
    const result = await flushOfflineQueue();
    refreshState();
    return result;
  }, [refreshState]);

  const clear = useCallback(() => {
    clearOfflineQueue();
    refreshState();
  }, [refreshState]);

  const clearFailures = useCallback(() => {
    clearDeadLetters();
    refreshState();
  }, [refreshState]);

  return {
    queue,
    pendingCount,
    isFlushing,
    deadLetters,
    enqueue,
    flush,
    clear,
    clearFailures,
    refreshState,
  };
}

export default useOfflineQueue;

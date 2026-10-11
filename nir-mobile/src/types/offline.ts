export interface OfflineMutation<T = any> {
  id: string;
  endpoint: string;
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  payload: T;
  createdAt: number;
  retryCount: number;
  headers?: Record<string, string>;
  lastError?: string;
}

export interface DeadLetterItem<T = any> {
  id: string;
  mutation: OfflineMutation<T>;
  failedAt: number;
  statusCode?: number;
  reason: string;
}

export interface NetworkState {
  isConnected: boolean;
  isInternetReachable: boolean | null;
}

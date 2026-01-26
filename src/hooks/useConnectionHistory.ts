import { useState, useCallback } from 'react';
import {
  getConnectionHistory,
  saveConnection,
  removeConnection,
  clearConnectionHistory
} from '../utils/connectionHistory';
import type { ConnectionRecord } from '../types';

export function useConnectionHistory() {
  const [history, setHistory] = useState<ConnectionRecord[]>(() => getConnectionHistory());

  const save = useCallback((record: ConnectionRecord) => {
    saveConnection(record);
    setHistory(getConnectionHistory());
  }, []);

  const remove = useCallback((sessionId: string) => {
    removeConnection(sessionId);
    setHistory(getConnectionHistory());
  }, []);

  const clear = useCallback(() => {
    clearConnectionHistory();
    setHistory([]);
  }, []);

  const refresh = useCallback(() => {
    setHistory(getConnectionHistory());
  }, []);

  return {
    history,
    saveConnection: save,
    removeConnection: remove,
    clearHistory: clear,
    refreshHistory: refresh
  };
}

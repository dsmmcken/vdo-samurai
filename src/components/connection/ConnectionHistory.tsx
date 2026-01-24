import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getConnectionHistory,
  removeConnection,
  clearConnectionHistory
} from '../../services/storage/connectionHistory';
import type { ConnectionRecord } from '../../types';

export function ConnectionHistory() {
  const [history, setHistory] = useState<ConnectionRecord[]>(() => getConnectionHistory());
  const navigate = useNavigate();

  const handleRemove = (sessionId: string) => {
    removeConnection(sessionId);
    setHistory(getConnectionHistory());
  };

  const handleClear = () => {
    clearConnectionHistory();
    setHistory([]);
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return date.toLocaleDateString();
  };

  if (history.length === 0) {
    return null;
  }

  return (
    <div className="bg-[--color-dark-lighter] rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Recent Sessions</h2>
        <button
          onClick={handleClear}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Clear all
        </button>
      </div>

      <div className="space-y-2">
        {history.map((record) => (
          <div
            key={record.sessionId}
            className="flex items-center justify-between p-3 bg-[--color-dark] rounded-lg hover:bg-[--color-dark]/80 transition-colors group"
          >
            <button
              onClick={() => navigate(`/session/${record.sessionId}`)}
              className="flex-1 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{record.name}</span>
                {record.isHost && (
                  <span className="text-xs bg-[--color-primary]/20 text-[--color-primary] px-2 py-0.5 rounded">
                    Host
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-500">
                {formatDate(record.timestamp)} · {record.sessionId.slice(0, 8)}...
              </p>
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleRemove(record.sessionId);
              }}
              className="p-2 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
              aria-label="Remove from history"
              title="Remove from history"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Banner component shown when there are unsent recordings from a previous session
 * Allows users to reconnect and send, or download locally as backup
 */

import { type PendingTransfer } from '../utils/browserStorage';

interface PendingTransferBannerProps {
  transfers: PendingTransfer[];
  onReconnect: (sessionCode: string) => void;
  onDownload: (id: string) => void;
  onDismiss: (id: string) => void;
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function PendingTransferBanner({
  transfers,
  onReconnect,
  onDownload,
  onDismiss
}: PendingTransferBannerProps) {
  if (transfers.length === 0) return null;

  // Group transfers by session
  const sessionGroups = transfers.reduce(
    (acc, transfer) => {
      if (!acc[transfer.sessionCode]) {
        acc[transfer.sessionCode] = [];
      }
      acc[transfer.sessionCode].push(transfer);
      return acc;
    },
    {} as Record<string, PendingTransfer[]>
  );

  return (
    <div className="bg-amber-900/30 border border-amber-500/50 rounded-lg p-4 mb-4">
      <div className="flex items-start gap-3">
        <div className="text-amber-400 text-xl">⚠️</div>
        <div className="flex-1">
          <h3 className="text-amber-200 font-semibold mb-2">
            Unsent Recording{transfers.length > 1 ? 's' : ''}
          </h3>
          <p className="text-amber-100/80 text-sm mb-3">
            You have {transfers.length} recording{transfers.length > 1 ? 's' : ''} from a previous
            session that {transfers.length > 1 ? 'were' : 'was'} not sent to the host.
          </p>

          {Object.entries(sessionGroups).map(([sessionCode, sessionTransfers]) => (
            <div
              key={sessionCode}
              className="bg-black/30 rounded-lg p-3 mb-2 last:mb-0"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 font-mono">
                  Session: {sessionCode.split('?p=')[0].slice(0, 30)}...
                </span>
                <span className="text-xs text-gray-500">
                  {formatTimeAgo(sessionTransfers[0].createdAt)}
                </span>
              </div>

              <div className="space-y-1 mb-3">
                {sessionTransfers.map((transfer) => (
                  <div
                    key={transfer.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-gray-300">
                      {transfer.type === 'camera' ? '📹' : '🖥️'} {transfer.type} recording
                    </span>
                    <span className="text-gray-500">{formatFileSize(transfer.blob.size)}</span>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => onReconnect(sessionCode)}
                  className="flex-1 px-3 py-1.5 bg-pink-600 hover:bg-pink-500 text-white text-sm font-medium rounded transition-colors"
                >
                  Reconnect & Send
                </button>
                <button
                  onClick={() => {
                    sessionTransfers.forEach((t) => onDownload(t.id));
                  }}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded transition-colors"
                  title="Download recordings locally"
                >
                  Download
                </button>
                <button
                  onClick={() => {
                    sessionTransfers.forEach((t) => onDismiss(t.id));
                  }}
                  className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 text-sm rounded transition-colors"
                  title="Discard recordings"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

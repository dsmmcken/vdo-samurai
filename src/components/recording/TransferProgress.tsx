import { useTransferStore } from '../../store/transferStore';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function TransferProgress() {
  const { transfers, isTransferring } = useTransferStore();

  const activeTransfers = transfers.filter((t) => t.status === 'pending' || t.status === 'active');

  const completedTransfers = transfers.filter((t) => t.status === 'complete');
  const errorTransfers = transfers.filter((t) => t.status === 'error');

  if (transfers.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-[--color-dark-lighter] rounded-xl p-4 shadow-2xl z-40 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white flex items-center gap-2">
          {isTransferring() && (
            <svg className="animate-spin h-4 w-4 text-[--color-primary]" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          File Transfers
        </h3>
        <div className="flex items-center gap-2 text-xs">
          {completedTransfers.length > 0 && (
            <span className="text-green-400">{completedTransfers.length} done</span>
          )}
          {errorTransfers.length > 0 && (
            <span className="text-red-400">{errorTransfers.length} failed</span>
          )}
        </div>
      </div>

      <div className="space-y-3 max-h-64 overflow-y-auto">
        {activeTransfers.map((transfer) => (
          <div key={transfer.id} className="space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-white font-medium truncate flex-1">
                {transfer.direction === 'send' ? '↑' : '↓'} {transfer.peerName}
              </span>
              <span className="text-gray-400 ml-2">
                {formatBytes(transfer.size * transfer.progress)} / {formatBytes(transfer.size)}
              </span>
            </div>

            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  transfer.status === 'error' ? 'bg-red-500' : 'bg-[--color-primary]'
                }`}
                style={{ width: `${transfer.progress * 100}%` }}
              />
            </div>

            <div className="flex justify-between text-xs text-gray-500">
              <span>{transfer.filename}</span>
              <span>{Math.round(transfer.progress * 100)}%</span>
            </div>
          </div>
        ))}

        {/* Show completed/error transfers in collapsed form */}
        {(completedTransfers.length > 0 || errorTransfers.length > 0) &&
          activeTransfers.length > 0 && (
            <div className="border-t border-gray-700 pt-2 mt-2">
              <p className="text-xs text-gray-500">
                {completedTransfers.length} completed, {errorTransfers.length} failed
              </p>
            </div>
          )}

        {/* Show errors */}
        {errorTransfers.map((transfer) => (
          <div key={transfer.id} className="text-sm">
            <div className="flex items-center gap-2 text-red-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>
                {transfer.peerName}: {transfer.error}
              </span>
            </div>
          </div>
        ))}
      </div>

      {isTransferring() && (
        <p className="text-xs text-gray-500 mt-3 flex items-center gap-1">
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          Don't close this window while transfers are in progress.
        </p>
      )}
    </div>
  );
}

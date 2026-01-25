import { useTransferStore } from '../../store/transferStore';

export function TransferQueue() {
  const { transfers } = useTransferStore();

  // Only show receiving transfers that are pending or active
  const activeTransfers = transfers.filter(
    (t) => t.direction === 'receive' && (t.status === 'pending' || t.status === 'active')
  );

  if (activeTransfers.length === 0) return null;

  return (
    <div className="absolute top-4 left-4 z-30 bg-black/80 backdrop-blur-sm rounded-lg border border-gray-700 p-3 min-w-[200px] max-w-[280px]">
      <div className="flex items-center gap-2 mb-2">
        <svg
          className="w-4 h-4 text-[--color-primary] animate-pulse"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
          />
        </svg>
        <span className="text-xs font-medium text-white">Receiving Files</span>
      </div>

      <div className="space-y-2">
        {activeTransfers.map((transfer) => (
          <div key={transfer.id} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-300 truncate max-w-[150px]">{transfer.peerName}</span>
              <span className="text-gray-500">{Math.round(transfer.progress * 100)}%</span>
            </div>
            <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-[--color-primary] transition-all duration-300"
                style={{ width: `${transfer.progress * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-gray-500 mt-2">
        {activeTransfers.length} transfer{activeTransfers.length > 1 ? 's' : ''} in progress
      </p>
    </div>
  );
}

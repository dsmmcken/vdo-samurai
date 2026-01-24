import { useNavigate } from 'react-router-dom';
import { CompositeEditor } from '../components/compositing';
import { useComposite } from '../hooks/useComposite';
import { useTransferStore } from '../store/transferStore';
import { useRecordingStore } from '../store/recordingStore';

export function CompositePage() {
  const navigate = useNavigate();
  const { hasSourcesAvailable } = useComposite();
  const { receivedRecordings, clearReceivedRecordings } = useTransferStore();
  const { localBlob } = useRecordingStore();

  const handleBack = () => {
    navigate('/');
  };

  const handleClearRecordings = () => {
    if (
      window.confirm(
        'Are you sure you want to clear all received recordings? This cannot be undone.'
      )
    ) {
      clearReceivedRecordings();
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-gray-400 hover:text-white transition-colors mb-4"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            Back to Home
          </button>
          <h1 className="text-2xl font-bold text-white">Video Composite</h1>
          <p className="text-gray-400 mt-1">Combine and export your recorded videos</p>
        </div>

        {hasSourcesAvailable && (
          <button
            onClick={handleClearRecordings}
            className="text-sm text-red-400 hover:text-red-300 transition-colors"
          >
            Clear All Recordings
          </button>
        )}
      </div>

      {/* Recording summary */}
      {hasSourcesAvailable && (
        <div className="bg-[--color-dark-lighter] rounded-xl p-4">
          <h3 className="text-sm font-medium text-gray-300 mb-3">Available Recordings</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {localBlob && (
              <div className="p-3 bg-[--color-dark] rounded-lg">
                <div className="text-white font-medium text-sm">My Recording</div>
                <div className="text-xs text-gray-500 mt-1">
                  {(localBlob.size / (1024 * 1024)).toFixed(1)} MB
                </div>
              </div>
            )}

            {receivedRecordings.map((recording, index) => (
              <div key={index} className="p-3 bg-[--color-dark] rounded-lg">
                <div className="text-white font-medium text-sm">{recording.peerName}</div>
                <div className="text-xs text-gray-500 mt-1">
                  {(recording.blob.size / (1024 * 1024)).toFixed(1)} MB
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Composite editor */}
      <CompositeEditor />

      {/* Help text */}
      {!hasSourcesAvailable && (
        <div className="text-center py-12">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gray-800 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">No Recordings Yet</h2>
          <p className="text-gray-400 max-w-md mx-auto">
            To create a video composite, first start a session and record with your participants.
            All recordings will appear here automatically.
          </p>
          <button
            onClick={() => navigate('/')}
            className="mt-6 px-6 py-2 bg-[--color-primary] hover:bg-[--color-primary-dark] text-white rounded-lg font-medium transition-colors"
          >
            Start a Session
          </button>
        </div>
      )}

      {/* Info cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="p-4 bg-[--color-dark-lighter] rounded-lg">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mb-3">
            <svg
              className="w-5 h-5 text-blue-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h4 className="text-white font-medium mb-1">Browser-Based</h4>
          <p className="text-sm text-gray-400">
            All processing happens locally in your browser. No uploads required.
          </p>
        </div>

        <div className="p-4 bg-[--color-dark-lighter] rounded-lg">
          <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center mb-3">
            <svg
              className="w-5 h-5 text-green-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h4 className="text-white font-medium mb-1">Privacy First</h4>
          <p className="text-sm text-gray-400">
            Your videos never leave your device until you choose to share them.
          </p>
        </div>

        <div className="p-4 bg-[--color-dark-lighter] rounded-lg">
          <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center mb-3">
            <svg
              className="w-5 h-5 text-purple-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <h4 className="text-white font-medium mb-1">Multiple Formats</h4>
          <p className="text-sm text-gray-400">
            Export to WebM (VP9) or MP4 (H.264) depending on your needs.
          </p>
        </div>
      </div>
    </div>
  );
}

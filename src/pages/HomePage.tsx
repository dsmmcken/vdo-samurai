import { Link } from 'react-router-dom';
import { CreateSession } from '../components/connection/CreateSession';
import { JoinSession } from '../components/connection/JoinSession';
import { ConnectionHistory } from '../components/connection/ConnectionHistory';
import { useRecordingStore } from '../store/recordingStore';
import { useTransferStore } from '../store/transferStore';

export function HomePage() {
  const { localBlob } = useRecordingStore();
  const { receivedRecordings } = useTransferStore();

  const hasRecordings = localBlob !== null || receivedRecordings.length > 0;
  const recordingCount = (localBlob ? 1 : 0) + receivedRecordings.length;

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          <span className="text-[--color-primary]">VDO</span> Samurai
        </h1>
        <p className="text-gray-400 text-lg">
          Peer-to-peer screen sharing and recording. No servers, no limits.
        </p>
      </div>

      {/* Composite banner when recordings are available */}
      {hasRecordings && (
        <Link
          to="/composite"
          className="block mb-8 p-4 bg-gradient-to-r from-[--color-primary]/20 to-purple-500/20 rounded-xl border border-[--color-primary]/30 hover:border-[--color-primary]/50 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-[--color-primary]/20 flex items-center justify-center">
                <svg
                  className="w-6 h-6 text-[--color-primary]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 4V2M17 4V2M3 8h18M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"
                  />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold">Ready to Composite</h3>
                <p className="text-gray-400 text-sm">
                  {recordingCount} recording{recordingCount !== 1 ? 's' : ''} available
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[--color-primary]">
              <span className="text-sm font-medium">Create Video</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </div>
          </div>
        </Link>
      )}

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <CreateSession />
        <JoinSession />
      </div>

      <ConnectionHistory />

      {/* Composite link */}
      <div className="mt-8">
        <Link
          to="/composite"
          className="flex items-center justify-center gap-2 p-4 bg-[--color-dark-lighter] rounded-xl border border-gray-700 hover:border-gray-600 transition-colors"
        >
          <svg
            className="w-5 h-5 text-gray-400"
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
          <span className="text-gray-300">Video Composite Editor</span>
        </Link>
      </div>

      <div className="mt-12 text-center text-gray-500 text-sm">
        <p className="mb-2">All connections are peer-to-peer using WebRTC.</p>
        <p>Your video and audio never touch our servers.</p>
      </div>
    </div>
  );
}

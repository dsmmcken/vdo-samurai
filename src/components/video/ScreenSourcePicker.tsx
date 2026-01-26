import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScreenSource } from '../../types/electron';

interface ScreenSourcePickerProps {
  onSelect: (sourceId: string) => void;
  onCancel: () => void;
}

export function ScreenSourcePicker({ onSelect, onCancel }: ScreenSourcePickerProps) {
  const [sources, setSources] = useState<ScreenSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    async function loadSources() {
      try {
        const result = await window.electronAPI.screenCapture.getSources();
        if (result.success && result.sources) {
          setSources(result.sources);
          // Pre-select first screen
          const firstScreen = result.sources.find((s) => s.id.startsWith('screen:'));
          if (firstScreen) {
            setSelectedId(firstScreen.id);
          } else if (result.sources.length > 0) {
            setSelectedId(result.sources[0].id);
          }
        } else {
          setError(result.error || 'Failed to load screen sources');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load screen sources');
      } finally {
        setLoading(false);
      }
    }
    loadSources();
  }, []);

  const screens = sources.filter((s) => s.id.startsWith('screen:'));
  const windows = sources.filter((s) => s.id.startsWith('window:'));

  const handleConfirm = () => {
    if (selectedId) {
      onSelect(selectedId);
    }
  };

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else if (e.key === 'Enter' && selectedId) {
        onSelect(selectedId);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel, onSelect, selectedId]);

  return createPortal(
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="screen-picker-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-gray-900 rounded-xl shadow-2xl max-w-4xl w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="p-4 border-b border-gray-700">
          <h2 id="screen-picker-title" className="text-xl font-semibold text-white">
            Choose what to share
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
            </div>
          )}

          {error && (
            <div className="text-red-400 text-center py-12">
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && (
            <>
              {screens.length > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-gray-400 mb-3">Screens</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {screens.map((source) => (
                      <SourceTile
                        key={source.id}
                        source={source}
                        selected={selectedId === source.id}
                        onSelect={() => setSelectedId(source.id)}
                        onDoubleClick={() => onSelect(source.id)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {windows.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-400 mb-3">Windows</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {windows.map((source) => (
                      <SourceTile
                        key={source.id}
                        source={source}
                        selected={selectedId === source.id}
                        onSelect={() => setSelectedId(source.id)}
                        onDoubleClick={() => onSelect(source.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 border-t border-gray-700 flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedId}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Share
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

interface SourceTileProps {
  source: ScreenSource;
  selected: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
}

function SourceTile({ source, selected, onSelect, onDoubleClick }: SourceTileProps) {
  return (
    <button
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      className={`
        relative rounded-lg overflow-hidden border-2 transition-all
        ${selected ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-gray-700 hover:border-gray-600'}
      `}
    >
      <img
        src={source.thumbnail}
        alt={source.name}
        className="w-full aspect-video object-cover bg-gray-800"
      />
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
        <p className="text-white text-xs truncate">{source.name}</p>
      </div>
      {selected && (
        <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      )}
    </button>
  );
}

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Video } from './Video';

/**
 * Your own screen share as a little live thumbnail on your tile (only you see
 * it). Hover for a bigger preview above the tile.
 */
export function ScreenThumb({ stream, onStage }: { stream: MediaStream; onStage: boolean }) {
  const [peek, setPeek] = useState<DOMRect | null>(null);
  return (
    <>
      <span
        className={`screen-thumb ${onStage ? 'on' : ''}`}
        onMouseEnter={(e) => setPeek(e.currentTarget.getBoundingClientRect())}
        onMouseLeave={() => setPeek(null)}
        title="Your screen share"
      >
        <Video stream={stream} fit="cover" />
      </span>
      {peek &&
        createPortal(
          <div className="screen-peek" style={{ left: Math.max(12, Math.min(window.innerWidth - 492, peek.left + peek.width / 2 - 240)), top: peek.top - 12 }}>
            <Video stream={stream} fit="contain" />
            <span>{onStage ? 'Your screen · on stage' : 'Your screen · ready'}</span>
          </div>,
          document.body,
        )}
    </>
  );
}

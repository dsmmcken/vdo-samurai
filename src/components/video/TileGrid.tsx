import { useCallback, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useSessionStore } from '../../store/sessionStore';
import { usePeerStore } from '../../store/peerStore';
import { useFocus } from '../../hooks/useFocus';
import { useMediaStream } from '../../hooks/useMediaStream';
import { useTileOrder } from '../../hooks/useTileOrder';
import { useHostTransfer } from '../../hooks/useHostTransfer';
import { isElectron } from '../../utils/platform';
import { SortableTile } from './SortableTile';
import { TileContextMenu } from './TileContextMenu';

const SELF_ID = 'self';

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  participantId: string;
}

export function TileGrid() {
  const { localStream, localScreenStream, isHost } = useSessionStore();
  const { peers } = usePeerStore();
  const { focusedPeerId, changeFocus } = useFocus();
  const { isVideoEnabled, isAudioEnabled } = useMediaStream();
  const { orderedParticipantIds, reorder } = useTileOrder();
  const { canMakeHost, makeHost, isLocalElectron } = useHostTransfer();

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    participantId: ''
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 } // Prevent accidental drags
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = orderedParticipantIds.indexOf(active.id as string);
      const newIndex = orderedParticipantIds.indexOf(over.id as string);
      reorder(oldIndex, newIndex); // This broadcasts to peers
    }
  };

  // Handle right-click on tiles
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, participantId: string) => {
      // Only show context menu for Electron users
      if (!isLocalElectron) return;

      e.preventDefault();
      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        participantId
      });
    },
    [isLocalElectron]
  );

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleMakeHost = useCallback(() => {
    if (contextMenu.participantId) {
      makeHost(contextMenu.participantId);
    }
  }, [contextMenu.participantId, makeHost]);

  // Get participant data by ID
  const getParticipantData = useCallback(
    (id: string) => {
      if (id === SELF_ID) {
        return {
          id: SELF_ID,
          stream: localStream,
          screenStream: localScreenStream,
          name: 'You',
          isHost: isHost,
          isElectron: isElectron(),
          videoEnabled: isVideoEnabled(),
          audioEnabled: isAudioEnabled(),
          isScreenSharing: false,
          muted: true
        };
      }

      const peer = peers.find((p) => p.id === id);
      if (!peer) return null;

      return {
        id: peer.id,
        stream: peer.stream,
        screenStream: peer.screenStream,
        name: peer.name,
        isHost: peer.isHost,
        isElectron: peer.isElectron,
        videoEnabled: peer.videoEnabled,
        audioEnabled: peer.audioEnabled,
        isScreenSharing: peer.isScreenSharing,
        muted: false
      };
    },
    [localStream, localScreenStream, isHost, isVideoEnabled, isAudioEnabled, peers]
  );

  // Get context menu participant data
  const contextMenuParticipant = contextMenu.participantId
    ? getParticipantData(contextMenu.participantId)
    : null;

  const canMakeHostResult = contextMenu.participantId
    ? canMakeHost(contextMenu.participantId)
    : { allowed: false };

  const totalParticipants = orderedParticipantIds.length;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={orderedParticipantIds} strategy={horizontalListSortingStrategy}>
          <div
            className="flex gap-2 overflow-hidden"
            role="list"
            aria-label={`Participant tiles (${totalParticipants} participant${totalParticipants !== 1 ? 's' : ''})`}
          >
            {orderedParticipantIds.map((participantId) => {
              const participant = getParticipantData(participantId);
              if (!participant) return null;

              const isSelf = participantId === SELF_ID;
              const isFocused = isSelf ? focusedPeerId === null : focusedPeerId === participantId;

              return (
                <SortableTile
                  key={participantId}
                  id={participantId}
                  participant={participant}
                  isFocused={isFocused}
                  onFocusClick={() => changeFocus(isSelf ? null : participantId)}
                  onContextMenu={(e) => handleContextMenu(e, participantId)}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {/* Context menu for tiles */}
      {contextMenuParticipant && (
        <TileContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          participantId={contextMenu.participantId}
          participantName={contextMenuParticipant.name}
          isParticipantHost={contextMenuParticipant.isHost}
          isParticipantElectron={contextMenuParticipant.isElectron}
          canMakeHost={canMakeHostResult.allowed}
          disabledReason={canMakeHostResult.reason}
          onClose={closeContextMenu}
          onMakeHost={handleMakeHost}
        />
      )}
    </>
  );
}

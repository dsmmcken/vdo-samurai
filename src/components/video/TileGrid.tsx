import { useCallback } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useSessionStore } from '../../store/sessionStore';
import { usePeerStore } from '../../store/peerStore';
import { useFocus } from '../../hooks/useFocus';
import { useMediaStream } from '../../hooks/useMediaStream';
import { useTileOrder } from '../../hooks/useTileOrder';
import { SortableTile } from './SortableTile';

const SELF_ID = 'self';

export function TileGrid() {
  const { localStream, localScreenStream, isHost } = useSessionStore();
  const { peers } = usePeerStore();
  const { focusedPeerId, changeFocus } = useFocus();
  const { isVideoEnabled, isAudioEnabled } = useMediaStream();
  const { orderedParticipantIds, reorder } = useTileOrder();

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
        videoEnabled: peer.videoEnabled,
        audioEnabled: peer.audioEnabled,
        isScreenSharing: peer.isScreenSharing,
        muted: false
      };
    },
    [localStream, localScreenStream, isHost, isVideoEnabled, isAudioEnabled, peers]
  );

  const totalParticipants = orderedParticipantIds.length;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={orderedParticipantIds} strategy={horizontalListSortingStrategy}>
        <div
          className="flex gap-2 overflow-x-auto"
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
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

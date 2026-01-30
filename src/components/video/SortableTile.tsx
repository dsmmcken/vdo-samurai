import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { UserTile } from './UserTile';

interface ParticipantData {
  id: string;
  stream: MediaStream | null;
  screenStream: MediaStream | null;
  name: string;
  isHost: boolean;
  videoEnabled: boolean;
  audioEnabled: boolean;
  isScreenSharing: boolean;
  muted: boolean;
}

interface SortableTileProps {
  id: string;
  participant: ParticipantData;
  isFocused: boolean;
  onFocusClick: () => void;
}

export function SortableTile({ id, participant, isFocused, onFocusClick }: SortableTileProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : ('auto' as const),
    opacity: isDragging ? 0.8 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    scale: isDragging ? 1.05 : 1
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} role="listitem">
      <UserTile
        stream={participant.stream}
        screenStream={participant.screenStream}
        name={participant.name}
        isHost={participant.isHost}
        isFocused={isFocused}
        onClick={onFocusClick}
        muted={participant.muted}
        videoEnabled={participant.videoEnabled}
        audioEnabled={participant.audioEnabled}
        isScreenSharing={participant.isScreenSharing}
      />
    </div>
  );
}

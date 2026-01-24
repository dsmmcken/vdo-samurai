import { useSessionStore } from '../../store/sessionStore';
import { usePeerStore } from '../../store/peerStore';
import { useFocus } from '../../hooks/useFocus';
import { signalingService } from '../../services/p2p';
import { UserTile } from './UserTile';

export function TileGrid() {
  const { localStream, localScreenStream, isHost } = useSessionStore();
  const { peers } = usePeerStore();
  const room = signalingService.getRoom();
  const { focusedPeerId, changeFocus } = useFocus(room ?? undefined);

  const totalParticipants = peers.length + 1;

  return (
    <div
      className="flex gap-2 overflow-x-auto"
      role="list"
      aria-label={`Participant tiles (${totalParticipants} participant${totalParticipants !== 1 ? 's' : ''})`}
    >
      {/* Local user tile */}
      <div role="listitem">
        <UserTile
          stream={localStream}
          screenStream={localScreenStream}
          name="You"
          isHost={isHost}
          isFocused={focusedPeerId === null}
          onClick={() => changeFocus(null)}
          muted
        />
      </div>

      {/* Remote peer tiles */}
      {peers.map((peer) => (
        <div key={peer.id} role="listitem">
          <UserTile
            stream={peer.stream}
            screenStream={peer.screenStream}
            name={peer.name}
            isHost={peer.isHost}
            isFocused={focusedPeerId === peer.id}
            onClick={() => changeFocus(peer.id)}
          />
        </div>
      ))}
    </div>
  );
}

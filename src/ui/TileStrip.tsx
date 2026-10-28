import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Room, Snapshot } from '../lib/room';
import type { PeerId } from '../lib/types';
import { Helmet, Grid, MicOff, Pencil, Screen } from './icons';
import { nameOf } from './RoomView';
import { Video } from './Video';
import { MicMeter } from './MicMeter';
import { Avatar } from './Avatar';


export function TileStrip({ room, s, onEditProfile }: { room: Room; s: Snapshot; onEditProfile: (anchor: DOMRect, id: PeerId) => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number; id: PeerId | 'end'; rect: DOMRect } | null>(null);
  const [dragging, setDraggingState] = useState<PeerId | null>(null);
  // Drag events fire faster than React re-renders, so handlers read a ref.
  const dragRef = useRef<PeerId | null>(null);
  const previewRef = useRef<PeerId[] | null>(null);
  const setDragging = (id: PeerId | null) => ((dragRef.current = id), setDraggingState(id));
  // While dragging, the strip shows the order you'd get if you let go now.
  const [preview, setPreview] = useState<PeerId[] | null>(null);
  const locked = s.recording;
  const canSwitch = !locked || s.director === s.me;
  const st = s.stage;
  const order = preview ?? s.tiles;
  const flip = useFlip(order, dragging !== null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', close);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', close);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  /**
   * The drop slot comes from the cursor's x position over the strip, not from the
   * element under it: tiles slide while we reorder, and hit-testing a moving
   * tile makes the preview flip back and forth.
   */
  const hoverAt = (e: React.DragEvent<HTMLElement>) => {
    const dragging = dragRef.current;
    if (!dragging) return;
    const strip = e.currentTarget;
    const cur = previewRef.current ?? s.tiles;
    // Real tile positions (offsetLeft ignores the slide animation's transforms;
    // tiles differ in width once your screen tile sits next to yours).
    const x = e.clientX - strip.getBoundingClientRect().left + strip.scrollLeft;
    const others = [...strip.querySelectorAll<HTMLElement>('.tile[data-id]')].filter((el) => el.dataset.id !== dragging);
    const to = Math.min(cur.length - 1, others.filter((el) => el.offsetLeft + el.offsetWidth / 2 < x).length);
    if (cur.indexOf(dragging) === to) return;
    const next = cur.filter((id) => id !== dragging);
    next.splice(to, 0, dragging);
    previewRef.current = next;
    setPreview(next);
  };

  const endDrag = (commit: boolean) => {
    const next = previewRef.current;
    if (commit && next && next.join() !== s.tiles.join()) room.reorder(next);
    previewRef.current = null;
    setDragging(null);
    setPreview(null);
  };

  const openMenu = (e: React.MouseEvent, id: PeerId | 'end') => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, id, rect: (e.currentTarget as HTMLElement).getBoundingClientRect() });
  };

  return (
    <footer className={`strip ${canSwitch ? '' : 'readonly'}`} onDragOver={(e) => {
        if (!dragRef.current) return;
        e.preventDefault();
        hoverAt(e);
      }} onDrop={(e) => (e.preventDefault(), endDrag(true))}>
      {order.map((id) => {
        const me = id === s.me;
        const p = me ? null : s.peers.get(id);
        const hasScreen = me ? !!s.screen : !!p?.presence?.hasScreen;
        const muted = me ? s.micMuted : !!p?.presence?.micMuted;
        const active = st?.kind === 'peer' && st.id === id;
        return (
          <Fragment key={id}>
          <div
            data-id={id}
            ref={flip(id)}
            className={`tile ${active ? 'active' : ''} ${dragging === id ? 'dragging' : ''} ${me ? 'mine' : ''}`}
            role="button"
            tabIndex={0}
            draggable={!locked}
            onClick={() => room.clickTile(id)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && room.clickTile(id)}
            onContextMenu={(e) => openMenu(e, id)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', id);
              setDragging(id);
            }}
            onDragEnd={() => endDrag(false)}
          >
            <Video stream={me ? s.cam : p?.cam ?? null} mirror={me} />
            {(me ? s.camOff : p?.presence?.camOff) && <Avatar name={nameOf(s, id)} />}
            {!muted && <MicMeter stream={me ? s.cam : p?.cam ?? null} />}
            <div className="tile-badges">
              {s.director === id && (
                <span className="badge crown" title="Shōgun (director)">
                  <Helmet size={14} title="Shōgun (director)" />
                </span>
              )}
              {hasScreen && (
                <span className={`badge ${active && st?.kind === 'peer' && st.view === 'screen' ? 'on' : ''}`} title="Screen share ready">
                  <Screen size={14} title="Screen share" />
                </span>
              )}
              {muted && (
                <span className="badge" title="Muted">
                  <MicOff size={14} title="Muted" />
                </span>
              )}
            </div>
            {me && !s.director && !locked && (
              <button
                className="glass claim"
                onClick={(e) => {
                  e.stopPropagation();
                  room.setDirector(s.me);
                }}
              >
                <Helmet size={14} /> Claim Shōgun
              </button>
            )}
            <div className="tile-name">
              {nameOf(s, id)}
              {me && s.profile.name && <span className="you"> (you)</span>}
              {p?.route === 'relay' && <span className="you"> · relayed</span>}
            </div>
            {me && (
              <button
                className="glass tile-edit"
                title="Edit your name"
                aria-label="Edit your name"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditProfile(e.currentTarget.closest('.tile')!.getBoundingClientRect(), s.me);
                }}
              >
                <Pencil size={13} />
              </button>
            )}
          </div>
          {me && s.screen && <ScreenTile stream={s.screen} onStage={active && st?.kind === 'peer' && st.view === 'screen'} onClick={() => room.setStage({ kind: 'peer', id: s.me, view: 'screen' })} />}
          </Fragment>
        );
      })}
      <div
        className={`tile end-tile ${st?.kind === 'end' ? 'active' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => room.clickTile('end')}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && room.clickTile('end')}
      >
        <Grid size={34} />
        <div className="tile-name">End screen</div>
      </div>

      {menu && menu.id !== 'end' && (
        <div className="glass popover menu-list context" style={{ left: menu.x, top: menu.y }} onPointerDown={(e) => e.stopPropagation()}>
          {s.director === menu.id ? (
            <button disabled={locked} onClick={() => (room.setDirector(null), setMenu(null))}>
              <Helmet size={16} className="gold" /> {menu.id === s.me ? 'Step down as Shōgun (director)' : 'Remove as Shōgun (director)'}
            </button>
          ) : (
            <button disabled={locked} onClick={() => (room.setDirector(menu.id as PeerId), setMenu(null))}>
              <Helmet size={16} className="gold" /> {menu.id === s.me ? 'Become Shōgun (director)' : `Make ${nameOf(s, menu.id)} Shōgun (director)`}
            </button>
          )}
          <button onClick={() => (onEditProfile(menu.rect, menu.id as PeerId), setMenu(null))}>
            <Pencil size={16} /> {menu.id === s.me ? 'Edit your name' : `Edit ${nameOf(s, menu.id)}'s name`}
          </button>
          {locked && <p className="menu-note">The Shōgun (director) can't change while recording</p>}
        </div>
      )}
    </footer>
  );
}

/**
 * FLIP animation while dragging: tiles slide from where they were to their new slot.
 * Returns a ref-callback factory keyed by tile id.
 */
function useFlip(order: string[], animate: boolean) {
  const els = useRef(new Map<string, HTMLElement>());
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    for (const [id, el] of els.current) {
      const x = el.getBoundingClientRect().left;
      const prev = last.current.get(id);
      if (animate && prev !== undefined && Math.abs(prev - x) > 1) {
        el.animate([{ transform: `translateX(${prev - x}px)` }, { transform: 'translateX(0)' }], { duration: 180, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
      last.current.set(id, x);
    }
  }, [order.join()]);
  return (id: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  };
}

/** Your own screen share, shown only to you, as a tile at its real shape next to yours. */
function ScreenTile({ stream, onStage, onClick }: { stream: MediaStream; onStage: boolean; onClick: () => void }) {
  const st = stream.getVideoTracks()[0]?.getSettings();
  const aspect = st?.width && st?.height ? st.width / st.height : 16 / 9;
  const w = Math.round(Math.max(120, Math.min(360, 160 * aspect)));
  return (
    <div className={`tile screen-tile ${onStage ? 'active' : ''}`} style={{ '--w': `${w}px` } as React.CSSProperties} role="button" tabIndex={0} onClick={onClick} title="Your screen share (only you see this tile). Click to put it on stage.">
      <Video stream={stream} fit="contain" />
      <div className="tile-name">Your screen</div>
    </div>
  );
}

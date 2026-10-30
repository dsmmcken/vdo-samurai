import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Room, Snapshot } from '../lib/room';
import type { PeerId } from '../lib/types';
import { Helmet, Grid, MicOff, Pencil, Screen, Waves } from './icons';
import { nameOf } from './RoomView';
import { Video } from './Video';
import { MicMeter } from './MicMeter';
import { Avatar } from './Avatar';


/** A place in the strip: someone's tile, or Multicam. */
type Slot = PeerId | 'end';

/** Someone who just left: their tile stays, as it last was, while it animates out. */
interface Ghost {
  id: PeerId;
  /** Where it was in the strip. */
  at: number;
  /** The last snapshot that had them. */
  s: Snapshot;
}

export function TileStrip({ room, s, onEditProfile }: { room: Room; s: Snapshot; onEditProfile: (anchor: DOMRect, id: PeerId) => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number; id: PeerId | 'end'; rect: DOMRect } | null>(null);
  const [dragging, setDraggingState] = useState<Slot | null>(null);
  // Drag events fire faster than React re-renders, so handlers read a ref.
  const dragRef = useRef<Slot | null>(null);
  const previewRef = useRef<Slot[] | null>(null);
  const setDragging = (id: Slot | null) => ((dragRef.current = id), setDraggingState(id));
  // While dragging, the strip shows the order you'd get if you let go now.
  const [preview, setPreview] = useState<Slot[] | null>(null);
  const locked = s.recording;
  const canSwitch = !locked || s.director === s.me;
  const st = s.stage;
  const order = preview ?? s.strip;
  const flip = useFlip(order, dragging !== null);

  // Joins pop in and leaves shrink away (tile-in / tile-out in styles.css).
  // Tiles already there when the strip first shows just appear.
  const [first] = useState(() => new Set(s.strip));
  const last = useRef(s);
  useEffect(() => void (last.current = s));
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  // A puff where each leaving tile pops out of existence (its centre).
  const [puffs, setPuffs] = useState<{ ghost: Ghost; x: number; y: number }[]>([]);
  const [shown, setShown] = useState(s.strip);
  if (shown.join() !== s.strip.join()) {
    // Caught during render, so the tile that's leaving is never unmounted and remounted.
    setShown(s.strip);
    const gone = shown.flatMap((id, at) => (id !== 'end' && !s.strip.includes(id) ? [{ id, at, s: last.current }] : []));
    setGhosts((g) => [...g.filter((x) => !s.strip.includes(x.id)), ...gone]);
  }
  const slots: { id: Slot; ghost?: Ghost }[] = order.map((id) => ({ id }));
  for (const g of ghosts) slots.splice(Math.min(g.at, slots.length), 0, { id: g.id, ghost: g });

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
    const cur = previewRef.current ?? s.strip;
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
    if (commit && next && next.join() !== s.strip.join()) room.reorder(next);
    previewRef.current = null;
    setDragging(null);
    setPreview(null);
  };

  const drag = (id: Slot) => ({
    'data-id': id,
    ref: flip(id),
    draggable: !locked,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDragging(id);
    },
    onDragEnd: () => endDrag(false),
  });

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
      {slots.map(({ id, ghost }) => {
        if (id === 'end')
          return (
            <div
              key="end"
              {...drag('end')}
              className={`tile end-tile ${st?.kind === 'end' ? 'active' : ''} ${dragging === 'end' ? 'dragging' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => room.clickTile('end')}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && room.clickTile('end')}
            >
              <Grid size={34} />
              <div className="tile-name">Multicam</div>
            </div>
          );
        const me = id === s.me;
        const p = me ? null : (ghost?.s ?? s).peers.get(id);
        const hasScreen = me ? !!s.screen : !!p?.presence?.hasScreen;
        const muted = me ? s.micMuted : !!p?.presence?.micMuted;
        const denoised = me ? s.denoise : !!p?.presence?.denoise;
        // The ring marks what's on stage: with their screen up and the camera
        // overlay hidden, that's the screen (badge / screen tile), not the camera.
        const onStage = !ghost && st?.kind === 'peer' && st.id === id;
        const active = onStage && !(st.view === 'screen' && hasScreen && s.pip.hidden);
        const live = ghost
          ? {
              ref: (el: HTMLElement | null) => {
                if (!el || puffs.some((p) => p.ghost === ghost)) return;
                const r = el.getBoundingClientRect();
                setPuffs((p) => (p.some((x) => x.ghost === ghost) ? p : [...p, { ghost, x: r.left + r.width / 2, y: r.top + r.height / 2 }]));
              },
              onAnimationEnd: (e: React.AnimationEvent) =>
                e.target === e.currentTarget && e.animationName.startsWith('tile-out') && setGhosts((g) => g.filter((x) => x !== ghost)),
            }
          : {
              ...drag(id),
              role: 'button',
              tabIndex: 0,
              onClick: () => room.clickTile(id),
              onKeyDown: (e: React.KeyboardEvent) => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && room.clickTile(id),
              onContextMenu: (e: React.MouseEvent) => openMenu(e, id),
            };
        return (
          <Fragment key={id}>
          <div
            {...live}
            className={`tile ${active ? 'active' : ''} ${dragging === id ? 'dragging' : ''} ${me ? 'mine' : ''} ${first.has(id) ? '' : 'pop'} ${ghost ? 'leaving' : ''}`}
          >
            <Video stream={me ? s.cam : p?.cam ?? null} mirror={me} head={me ? s.head : p?.presence?.head ?? null} />
            {/* Leaving: their camera has already ended (black), so initials instead. */}
            {(ghost || (me ? s.camOff : p?.presence?.camOff)) && <Avatar name={nameOf(ghost?.s ?? s, id)} />}
            {!muted && !ghost && <MicMeter stream={me ? s.cam : p?.cam ?? null} />}
            <div className="tile-badges">
              {(ghost?.s ?? s).director === id && (
                <span className="badge crown" title="Shōgun (director)">
                  <Helmet size={14} title="Shōgun (director)" />
                </span>
              )}
              {hasScreen && (
                <span className={`badge ${onStage && st?.kind === 'peer' && st.view === 'screen' ? 'on' : ''}`} title="Screen share ready">
                  <Screen size={14} title="Screen share" />
                </span>
              )}
              {muted && (
                <span className="badge" title="Muted">
                  <MicOff size={14} title="Muted" />
                </span>
              )}
              {denoised && !muted && (
                <span className="badge" title="Noise reduction on">
                  <Waves size={14} title="Noise reduction on" />
                </span>
              )}
            </div>
            <div className="tile-name">
              {nameOf(ghost?.s ?? s, id)}
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
          {me && s.screen && <ScreenTile stream={s.screen} onStage={onStage && st?.kind === 'peer' && st.view === 'screen'} onClick={() => room.setStage({ kind: 'peer', id: s.me, view: 'screen' })} />}
          </Fragment>
        );
      })}
      {puffs.map((p) => (
        <TilePuff key={`${p.ghost.id}-${p.x}`} x={p.x} y={p.y} onDone={() => setPuffs((all) => all.filter((x) => x !== p))} />
      ))}

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
          {(() => {
            const id = menu.id as PeerId;
            const me = id === s.me;
            const p = s.peers.get(id)?.presence;
            const on = me ? s.denoise : !!p?.denoise;
            const muted = me ? s.micMuted : !!p?.micMuted;
            return (
              <>
                <button onClick={() => (room.setDenoiseOf(id, !on), setMenu(null))}>
                  <Waves size={16} /> {`Turn ${on ? 'off' : 'on'} noise reduction${me ? '' : ` for ${nameOf(s, id)}`}`}
                </button>
                {!me && !muted && (
                  <button onClick={() => (room.muteOf(id), setMenu(null))}>
                    <MicOff size={16} /> Mute {nameOf(s, id)}
                  </button>
                )}
              </>
            );
          })()}
          <button onClick={() => (onEditProfile(menu.rect, menu.id as PeerId), setMenu(null))}>
            <Pencil size={16} /> {menu.id === s.me ? 'Edit your name' : `Edit ${nameOf(s, menu.id)}'s name`}
          </button>
          {locked && <p className="menu-note">The Shōgun (director) can't change while recording</p>}
        </div>
      )}
    </footer>
  );
}

/** Soft clouds (dx, dy, size) bursting out around where a tile was. */
const TILE_PUFFS: [number, number, number][] = [
  [0, 0, 90],
  [-46, -26, 58],
  [44, -30, 54],
  [-40, 30, 52],
  [42, 28, 56],
  [0, -46, 48],
];

/** Same puff as the after-take panel's (styles.css), at a point on screen. */
function TilePuff({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 1200);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="tile-puff" style={{ left: x, top: y }} aria-hidden>
      {TILE_PUFFS.map(([dx, dy, size], i) => (
        <span key={i} style={{ '--dx': `${dx}px`, '--dy': `${dy}px`, width: size, height: size, animationDelay: `${0.06 + i * 0.025}s` } as React.CSSProperties} />
      ))}
    </div>
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
    <div className={`tile screen-tile pop ${onStage ? 'active' : ''}`} style={{ '--w': `${w}px` } as React.CSSProperties} role="button" tabIndex={0} onClick={onClick} title="Your screen share (only you see this tile). Click to put it on stage.">
      <Video stream={stream} fit="contain" />
      <div className="tile-name">Your screen</div>
    </div>
  );
}

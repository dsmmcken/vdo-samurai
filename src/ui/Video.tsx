import { useEffect, useMemo, useRef } from 'react';
import { cropFor, glide, type Head } from '../lib/framing';

/**
 * A muted, picture-only view of a stream. It's given a video-only copy of the
 * stream: Firefox only puts its Picture-in-Picture pop-out button on videos
 * that have an audio track (voices play through RemoteAudio instead), and
 * disablePictureInPicture asks every browser not to offer it.
 *
 * With `head` (auto-framing), a cover-fitted camera is panned and zoomed to
 * frame that head for this view's shape, gliding when it changes. It's one
 * GPU transform, recomputed only while gliding or when the view resizes.
 */
export function Video({ stream, mirror, fit = 'cover', head, className }: { stream: MediaStream | null; mirror?: boolean; fit?: 'cover' | 'contain'; head?: Head | null; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  // Rebuilt when the video track changes (camera switched or turned back on).
  const trackIds = stream?.getVideoTracks().map((t) => t.id).join() ?? '';
  const videoOnly = useMemo(() => (stream ? new MediaStream(stream.getVideoTracks()) : null), [stream, trackIds]);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== videoOnly) ref.current.srcObject = videoOnly;
  }, [videoOnly]);

  // Framing: `shown` glides toward `target` in animation frames. Until the
  // camera's size is known it's a plain cover-fit view.
  const framing = useRef({ target: null as Head | null, shown: null as Head | null, raf: 0, last: 0, start: undefined as undefined | (() => void) });
  const framed = fit === 'cover' && head !== undefined;
  useEffect(() => {
    const el = ref.current;
    if (!el || !framed) return;
    const f = framing.current;
    const apply = () => {
      const vw = el.videoWidth, vh = el.videoHeight, cw = el.clientWidth, ch = el.clientHeight;
      if (!vw || !vh || !cw || !ch) return;
      const c = cropFor(f.shown, vw, vh, cw / ch);
      // The whole frame is laid out uncropped ("contain": cover would clip it
      // to the box before we could pan), mapping frame (u, v) to
      // (ox + u*k, oy + v*k). Scale and shift so the crop fills the box; the
      // container clips the rest. Mirroring flips within the box first.
      const k = Math.min(cw / vw, ch / vh);
      const ox = (cw - vw * k) / 2, oy = (ch - vh * k) / 2;
      const x = mirror ? vw - c.x - c.w : c.x;
      const z = cw / (c.w * k);
      const tx = -z * (ox + x * k), ty = -z * (oy + c.y * k);
      el.style.objectFit = 'contain';
      el.style.transformOrigin = '0 0';
      el.style.transform = `translate(${tx}px, ${ty}px) scale(${z})${mirror ? ` translateX(${cw}px) scaleX(-1)` : ''}`;
    };
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - f.last) / 1000);
      f.last = t;
      if (f.target && f.shown) f.shown = glide(f.shown, f.target, dt);
      apply();
      const done = !f.target || !f.shown || Math.abs(f.shown.x - f.target.x) + Math.abs(f.shown.y - f.target.y) + Math.abs(f.shown.s - f.target.s) < 1e-4;
      if (done) {
        f.shown = f.target;
        apply();
        f.raf = 0;
      } else f.raf = requestAnimationFrame(tick);
    };
    f.start = () => {
      if (f.raf) return;
      f.last = performance.now();
      f.raf = requestAnimationFrame(tick);
    };
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    el.addEventListener('resize', apply); // the camera's resolution changed
    apply();
    return () => {
      ro.disconnect();
      el.removeEventListener('resize', apply);
      cancelAnimationFrame(f.raf);
      f.raf = 0;
      el.style.transform = mirror ? 'scaleX(-1)' : '';
      el.style.transformOrigin = '';
      el.style.objectFit = fit;
    };
  }, [framed, mirror, fit]);
  useEffect(() => {
    const f = framing.current;
    f.target = head ?? null;
    if (!f.shown || !f.target) f.shown = f.target; // first anchor: frame straight away
    f.start?.();
  }, [head?.x, head?.y, head?.s]);

  return (
    <video
      ref={ref}
      className={className}
      autoPlay
      playsInline
      muted
      disablePictureInPicture
      onContextMenu={(e) => e.preventDefault()}
      style={{ objectFit: fit, transform: framed ? undefined : mirror ? 'scaleX(-1)' : undefined }}
    />
  );
}

/** Plays a remote person's microphone. */
export function RemoteAudio({ stream, sinkId }: { stream: MediaStream | null; sinkId?: string | null }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream]);
  // Chosen speakers / headphones (Chrome's setSinkId); '' is the system default.
  useEffect(() => {
    const el = ref.current as (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> }) | null;
    el?.setSinkId?.(sinkId ?? '').catch((e) => console.warn('[audio] setSinkId failed', e));
  }, [sinkId]);
  return <audio ref={ref} autoPlay />;
}

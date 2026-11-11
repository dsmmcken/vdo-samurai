import { useEffect, useMemo, useRef, useState } from 'react';
import type { Room, RoomAnimation, Snapshot } from '../lib/room';
import type { AnimationEnd, AnimationMeta } from '../lib/animation-api';
import { ANIMATION_MAX_BYTES } from '../lib/animation-api';
import { assetName, assetsOf, dataUrlOf, fileKind, pack, setAsset, setOption, unpack, type AssetKind } from '../lib/animation-edit';
import { ANIMATION_ASK, ANIMATION_PROMPT } from '../lib/animation-prompt';
import { fmtBytes, now } from '../lib/util';
import { Tip } from './Tip';
import { Check, Clapper, Close, Code, Copy, Download, Plus, Sparkle, Trash } from './icons';
import { AnimationPlayer } from './AnimationPlayer';

/** What the right-hand side shows. */
type View = { k: 'welcome' } | { k: 'new' } | { k: 'prompt' } | { k: 'animation'; name: string };

const KIND_LABEL: Record<AssetKind, string> = { image: 'image', audio: 'sound', font: 'font' };
const ACCEPT: Record<AssetKind, string> = { image: 'image/*', audio: 'audio/*', font: '.ttf,.otf,.woff,.woff2,font/*' };

/** Long base64 assets, shortened for reading (the script itself is untouched). */
const readable = (code: string) =>
  code.replace(/(['"`])data:([\w/+.-]+);base64,([A-Za-z0-9+/=]{120,})\1/g, (_, q, mime, b64) => `${q}data:${mime};base64,…${q} /* ${fmtBytes(Math.round((b64.length * 3) / 4))} */`);

/** Picks one file of a kind (or any), then calls back with it. */
function pickFile(accept: string, then: (f: File) => void) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => input.files?.[0] && then(input.files[0]);
  input.click();
}

/**
 * Scripted animations: the room's library on the left; on the right the selected
 * animation, a new one, or how to create one with your own AI assistant.
 */
export function AnimationsPanel({ room, s, open, onClose }: { room: Room; s: Snapshot; open?: string; onClose: () => void }) {
  const [view, setView] = useState<View>(() => {
    const first = s.animations.find((x) => x.name === open) ?? s.animations[0];
    return first ? { k: 'animation', name: first.name } : { k: 'welcome' };
  });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  /** Where a dropped image, sound or font goes: the script being edited (set by whichever editor is showing). */
  const dropTarget = useRef<((f: File, kind: AssetKind) => void) | null>(null);

  const selected = view.k === 'animation' ? s.animations.find((x) => x.name === view.name) : undefined;
  // The selected animation was deleted (here or by someone else): show what's left.
  useEffect(() => {
    if (view.k === 'animation' && !selected) setView(s.animations.length ? { k: 'animation', name: s.animations[0].name } : { k: 'welcome' });
  }, [view, selected, s.animations]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('.tip-pop') && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => setAdded(null), 4000);
    return () => clearTimeout(t);
  }, [added]);

  const startNew = (text = '') => {
    setCode(text);
    setError(null);
    setView({ k: 'new' });
  };
  const loadExample = async () => {
    // The example (and the sound it makes) loads only when asked for.
    const { samuraiIntro } = await import('../lib/animation-examples');
    startNew(samuraiIntro());
  };

  /** A dropped or chosen file: a script opens as a new animation; an image, sound or font goes into the script being edited. */
  const takeFile = async (f: File) => {
    const kind = fileKind(f);
    if (kind) {
      if (dropTarget.current) return dropTarget.current(f, kind);
      return setError('Open or paste a script first, then add files to it.');
    }
    if (f.size > ANIMATION_MAX_BYTES) return (startNew(), setError(`${f.name} is ${fmtBytes(f.size)}; an animation can be at most ${fmtBytes(ANIMATION_MAX_BYTES)}, files included.`));
    startNew(await f.text());
  };
  // The new animation's editor takes dropped files while it's showing (an animation's Code tab sets its own).
  if (view.k === 'welcome' || view.k === 'prompt') dropTarget.current = null;
  if (view.k === 'new')
    dropTarget.current = code.trim()
      ? async (f, kind) => {
          const slots = assetsOf(code);
          const slot = slots.find((x) => x.missing && x.kind === kind);
          try {
            setCode(setAsset(code, slot?.name ?? assetName(f.name, slots.map((x) => x.name)), await dataUrlOf(f, kind)));
          } catch (e) {
            setError((e as Error).message);
          }
        }
      : null;

  const add = async () => {
    setBusy(true);
    setError(null);
    try {
      const name = await room.addAnimation(code);
      setAdded(name);
      setCode('');
      setView({ k: 'animation', name });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const missing = view.k === 'new' && code.trim() ? assetsOf(code).filter((x) => x.missing) : [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal animations-modal ${over ? 'drop' : ''}`}
        role="dialog"
        aria-label="Scripted animations"
        onDragOver={(e) => {
          if (![...e.dataTransfer.types].includes('Files')) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.files.length) return;
          e.preventDefault();
          setOver(false);
          takeFile(e.dataTransfer.files[0]);
        }}
      >
        <header className="animations-head">
          <Clapper size={18} />
          <h2>Scripted animations</h2>
          <Tip text="Short JavaScript canvas animations (intros, outros, interstitials) that play on the main stage for everyone and go into the final video. Everyone in this room keeps them, for later meetings too." />
          <span className="grow" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Close size={16} />
          </button>
        </header>

        <div className="animations-body">
          <aside className="animations-lib" aria-label="Library">
            <div className="lib-actions">
              <button className={`btn primary sm ${view.k === 'new' ? 'on' : ''}`} onClick={() => startNew(view.k === 'new' ? code : '')}>
                <Plus size={16} /> New animation
              </button>
              <button className="btn ghost sm" onClick={() => setView({ k: 'prompt' })}>
                <Sparkle size={15} /> Create with AI
              </button>
            </div>
            {s.animations.length > 0 && (
              <ul className="lib-list">
                {s.animations.map((sc) => (
                  <li key={sc.name} className="lib-row">
                    <input
                      type="checkbox"
                      role="switch"
                      className="toggle"
                      checked={sc.pinned}
                      disabled={s.recording}
                      onChange={(e) => room.pinAnimation(sc.name, e.target.checked)}
                      title={s.recording ? "Can't change while recording" : sc.pinned ? 'Enabled: it has a tile in the strip' : 'Enable: give it a tile in the strip'}
                      aria-label={`Enable ${sc.name}`}
                    />
                    <button className={`lib-item ${view.k === 'animation' && view.name === sc.name ? 'on' : ''}`} onClick={() => setView({ k: 'animation', name: sc.name })} title={sc.error ?? undefined}>
                      <span className="lib-name">{sc.name}</span>
                    </button>
                    <button className="icon-btn lib-del" onClick={() => confirm(`Delete “${sc.name}” for everyone in this room?`) && room.removeAnimation(sc.name)} title="Delete for everyone" aria-label={`Delete ${sc.name}`}>
                      <Trash size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className="animations-main">
            {view.k === 'welcome' && <Welcome onExample={loadExample} onAI={() => setView({ k: 'prompt' })} onPaste={() => startNew()} />}
            {view.k === 'new' && (
              <div className="pane fill">
                <div className="pane-head">
                  <h3>New animation script</h3>
                </div>
                <Editor
                  code={code}
                  setCode={setCode}
                  error={error}
                  setError={setError}
                  action={
                    <>
                      <button className="btn ghost sm" onClick={loadExample}>
                        Load example
                      </button>
                      <button className="btn ghost sm" onClick={() => pickFile('.js,.mjs,.txt,text/javascript,text/plain', takeFile)}>
                        Open .js file
                      </button>
                      <span className="grow" />
                      <button className="btn ghost" disabled={busy} onClick={() => (setCode(''), setError(null), setView({ k: 'welcome' }))}>
                        Cancel
                      </button>
                      <button className="btn primary" disabled={busy || !code.trim() || missing.length > 0} onClick={add}>
                        {busy ? 'Checking…' : 'Add animation'}
                      </button>
                    </>
                  }
                />
              </div>
            )}
            {view.k === 'prompt' && <PromptPane onCancel={() => setView({ k: 'welcome' })} />}
            {view.k === 'animation' && selected && <AnimationPane key={selected.name} room={room} s={s} sc={selected} justAdded={added === selected.name} dropTarget={dropTarget} onDelete={() => confirm(`Delete “${selected.name}” for everyone in this room?`) && room.removeAnimation(selected.name)} onRenamed={(name) => setView({ k: 'animation', name })} />}
          </section>
        </div>
      </div>
    </div>
  );
}

/** Nothing yet: what a scripted animation is, and three ways to get a first one. */
function Welcome({ onExample, onAI, onPaste }: { onExample: () => void; onAI: () => void; onPaste: () => void }) {
  return (
    <div className="pane welcome">
      <h3>Intros, outros and interstitials, in code</h3>
      <p>
        Short JavaScript canvas animations. Each frame is drawn from the time alone, so it plays in sync for everyone and renders in full quality into the final video. Scripts run in a sandboxed worker with only a
        canvas and their own files: no network, storage or access to the page.
      </p>
      <div className="start-cards">
        <button className="start-card" onClick={onExample}>
          <Clapper size={20} />
          <strong>Load the VDO.Samurai example</strong>
          <span>A 5-second intro with sound</span>
        </button>
        <button className="start-card" onClick={onAI}>
          <Sparkle size={20} />
          <strong>Create one with AI</strong>
          <span>With your own AI assistant</span>
        </button>
        <button className="start-card" onClick={onPaste}>
          <Code size={20} />
          <strong>Paste a script</strong>
          <span>Or drop a .js file here</span>
        </button>
      </div>
    </div>
  );
}

/**
 * A script, then its files, then what to do with it: one above the other. The
 * script shows each embedded file as a short marker (⟨file 1 · 94 KB⟩), so
 * what's on screen is just the code.
 */
function Editor(p: {
  code: string;
  setCode: (c: string) => void;
  error: string | null;
  setError: (e: string | null) => void;
  action: React.ReactNode;
}) {
  const { text, files } = useMemo(() => pack(p.code), [p.code]);
  // Placeholders the script left for its files (assets: { logo: 'image' }): asked for here, then put in.
  const missing = useMemo(() => (p.code.trim() ? assetsOf(p.code).filter((x) => x.missing) : []), [p.code]);
  const empty = !p.code.trim();
  const fill = async (name: string, f: File, kind: AssetKind) => {
    try {
      p.setCode(setAsset(p.code, name, await dataUrlOf(f, kind)));
      p.setError(null);
    } catch (e) {
      p.setError((e as Error).message);
    }
  };
  return (
    <>
      <div className="field grow-field">
        <textarea
          id="animation-script"
          className="script-box"
          value={text}
          onChange={(e) => p.setCode(unpack(e.target.value, files))}
          placeholder={'Paste an animation script, or drop a .js file here.\n\nNo script yet? Use “Create with AI” on the left.'}
          spellCheck={false}
          aria-label="Animation script"
        />
      </div>
      {missing.length > 0 && (
        <div className="needs">
          <span>This animation needs</span>
          {missing.map((a) => (
            <button key={a.name} className="btn ghost sm" onClick={() => pickFile(ACCEPT[a.kind!], (f) => fill(a.name, f, a.kind!))}>
              {a.name} ({KIND_LABEL[a.kind!]})…
            </button>
          ))}
        </div>
      )}
      {p.error && <pre className="animation-error">{p.error}</pre>}
      <div className="field-actions">{p.action}</div>
    </>
  );
}

/**
 * Creating an animation with your own AI assistant, as one screen: the three
 * steps across the top, what to tell it, then the prompt; copy at the bottom right.
 */
function PromptPane({ onCancel }: { onCancel: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ANIMATION_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      window.prompt('Copy the prompt', ANIMATION_PROMPT);
    }
  };
  const steps: [string, string][] = [
    ['Copy the prompt', 'It teaches your AI how these animations work'],
    ['Ask your AI', 'Paste your prompt and describe what you want your animation to look like'],
    ['Create a new animation', 'Paste the script your AI writes into it'],
  ];
  return (
    <div className="pane fill">
      <div className="pane-head">
        <h3>Create an animation with your AI assistant</h3>
        <Tip text="VDO.Samurai doesn't create animations for you: use Claude, ChatGPT or any assistant you like. This prompt teaches it how they work." />
      </div>
      <ol className="wizard">
        {steps.map(([title, sub], i) => (
          <li key={title}>
            <span className="wizard-n">{i + 1}</span>
            <span className="wizard-text">
              <strong>{title}</strong>
              <span>{sub}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="ask">
        <div className="prompt-label">What to include in your request</div>
        <ul>
          {ANIMATION_ASK.map(([what, example]) => (
            <li key={what}>
              <strong>{what}</strong>
              <span>{example}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="prompt-label">Prompt</div>
      <pre className="prompt-view" tabIndex={0} aria-label="The prompt">
        {ANIMATION_PROMPT}
      </pre>
      <div className="pane-foot">
        <span className="grow" />
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={copy}>
          {/* A check for a moment; the label stays, so the button keeps its size (like CopyButton). */}
          {copied ? <Check size={15} /> : <Copy size={15} />} Copy prompt
        </button>
      </div>
    </div>
  );
}

const END_OPTIONS: { v: string; label: string }[] = [
  { v: 'prev', label: 'Back to what was on' },
  { v: 'hold', label: 'Hold the last frame' },
  { v: 'loop', label: 'Loop until switched' },
  { v: '+1', label: 'Go to the next tile' },
  { v: '-1', label: 'Go to the tile before' },
];
const endValue = (e: AnimationEnd) => (typeof e === 'object' ? `${e.tile > 0 ? '+' : ''}${e.tile}` : e);
const endSource = (v: string) => (/^[+-]?\d+$/.test(v) ? `{ tile: ${Number(v)} }` : `'${v}'`);

/** One animation: Preview (with its options) and Code (the editor) as tabs. */
function AnimationPane({ room, s, sc, justAdded, dropTarget, onDelete, onRenamed }: { room: Room; s: Snapshot; sc: RoomAnimation; justAdded: boolean; dropTarget: React.MutableRefObject<((f: File, kind: AssetKind) => void) | null>; onDelete: () => void; onRenamed: (name: string) => void }) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [code, setCode] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState('');
  const m: AnimationMeta | null = sc.meta;
  useEffect(() => {
    let gone = false;
    room.animationCode(sc.hash).then((c) => {
      if (gone) return;
      setCode(c);
      setDraft(c ?? '');
    });
    return () => void (gone = true);
  }, [sc.hash, sc.have]);
  useEffect(() => setDuration(m ? String(m.duration) : ''), [m?.duration]);
  // Files dropped on the window go into this script, in the Code tab.
  dropTarget.current = draft.trim()
    ? async (f, kind) => {
        setTab('code');
        const slots = assetsOf(draft);
        const slot = slots.find((x) => x.missing && x.kind === kind);
        try {
          setDraft(setAsset(draft, slot?.name ?? assetName(f.name, slots.map((x) => x.name)), await dataUrlOf(f, kind)));
        } catch (e) {
          setError((e as Error).message);
        }
      }
    : null;

  /** Saves a script as this animation's next version, for everyone. */
  const save = async (next: string) => {
    setSaving(true);
    setError(null);
    try {
      await room.addAnimation(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  /** An option changed: just that value in the script changes. */
  const change = (key: 'duration' | 'end' | 'microphones', src: string) => {
    if (!code) return;
    try {
      save(setOption(code, key, src));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const [name, setName] = useState(sc.name);
  useEffect(() => setName(sc.name), [sc.name]);
  /** A new name: the animation moves to it (renameAnimation), and the page follows. */
  const commitName = async () => {
    const to = name.trim();
    if (!to || to === sc.name) return setName(sc.name);
    setSaving(true);
    setError(null);
    try {
      onRenamed(await room.renameAnimation(sc.name, to));
    } catch (e) {
      setError((e as Error).message);
      setName(sc.name);
    } finally {
      setSaving(false);
    }
  };
  const commitDuration = () => {
    const d = Number(duration);
    if (!m || !(d > 0) || d === m.duration) return setDuration(m ? String(m.duration) : '');
    change('duration', String(Math.round(d * 100) / 100));
  };
  const download = () => {
    if (!code) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    a.download = `${sc.name.replace(/[^\w.-]+/g, '-')}.js`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const ends = m && typeof m.end === 'object' && Math.abs(m.end.tile) > 1 ? [...END_OPTIONS, { v: endValue(m.end), label: `Go ${Math.abs(m.end.tile)} tiles ${m.end.tile > 0 ? 'on' : 'back'}` }] : END_OPTIONS;
  const locked = s.recording || saving || !code;
  const status = sc.error ? "Doesn't work here" : !m ? (sc.have ? 'Checking…' : 'Arriving…') : !sc.readyAll ? `On ${sc.readyCount} of ${sc.total} computers` : null;
  const dirty = code !== null && draft !== code;
  const missing = draft.trim() ? assetsOf(draft).filter((x) => x.missing) : [];

  return (
    <div className="pane fill">
      <div className="pane-head">
        <h3>{sc.name}</h3>
        {status && (
          <span className={`pill ${sc.error ? 'bad' : 'wait'}`} title={sc.error ?? undefined}>
            {status}
          </span>
        )}
        {justAdded && <span className="animation-ok">Added. On its way to everyone here.</span>}
        <span className="grow" />
        <button className="btn ghost sm danger" onClick={onDelete} title="Delete for everyone">
          <Trash size={15} /> Delete
        </button>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>
            Preview
          </button>
          <button role="tab" aria-selected={tab === 'code'} className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>
            Code{dirty ? ' •' : ''}
          </button>
        </div>
      </div>

      {tab === 'preview' ? (
        <>
          <div className="animation-stage">
            {m && code ? (
              <AnimationPlayer key={sc.hash} code={code} meta={m} speaker={s.current.speaker} />
            ) : (
              <div className="animation-stage-empty">{sc.error ? 'No preview' : 'Preview when it arrives'}</div>
            )}
          </div>
          {m && (
            <div className="animation-options" aria-busy={saving}>
              <label className="opt">
                <span>Name</span>
                <input type="text" value={name} maxLength={60} disabled={locked} onChange={(e) => setName(e.target.value)} onBlur={commitName} onKeyDown={(e) => (e.key === 'Enter' ? (e.currentTarget as HTMLInputElement).blur() : e.key === 'Escape' && (e.stopPropagation(), setName(sc.name)))} />
              </label>
              <label className="opt">
                <span>Length</span>
                <span className="opt-control">
                  <input type="number" min={0.5} max={600} step={0.5} value={duration} disabled={locked} onChange={(e) => setDuration(e.target.value)} onBlur={commitDuration} onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()} />
                  <span className="muted">seconds</span>
                </span>
              </label>
              <label className="opt">
                <span>When it ends</span>
                <select value={endValue(m.end)} disabled={locked} onChange={(e) => change('end', endSource(e.target.value))}>
                  {ends.map((o) => (
                    <option key={o.v} value={o.v}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="opt">
                <span>
                  Microphones <Tip text="Which microphones are kept in the final video while it plays. Live, everyone still hears each other as usual." />
                </span>
                <select value={m.microphones} disabled={locked} onChange={(e) => change('microphones', `'${e.target.value}'`)}>
                  <option value="none">None</option>
                  <option value="director">The Shōgun's</option>
                  <option value="all">Everyone's</option>
                </select>
              </label>
            </div>
          )}
          {error && <pre className="animation-error">{error}</pre>}
        </>
      ) : (
        <Editor
          code={draft}
          setCode={setDraft}
          error={error}
          setError={setError}
          action={
            <>
              <button className="btn ghost sm" disabled={!code} onClick={download}>
                <Download size={15} /> Download .js
              </button>
              <span className="grow" />
              {dirty && (
                <button className="btn ghost" onClick={() => (setDraft(code ?? ''), setError(null))}>
                  Discard changes
                </button>
              )}
              <button className="btn primary" disabled={!dirty || saving || missing.length > 0 || s.recording} onClick={() => save(draft)}>
                {saving ? 'Checking…' : 'Save'}
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

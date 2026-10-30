import type { Head } from './framing';

export type PeerId = string;

export interface Profile {
  name: string;
  subtitle: string;
}

/** What one peer tells everyone about itself. */
export interface Presence {
  profile: Profile;
  hasScreen: boolean;
  micMuted: boolean;
  /** Noise reduction on our outgoing mic (denoise.ts). */
  denoise?: boolean;
  camOff?: boolean;
  /** Auto-framing: where views of this camera centre the head (null: plain centred crop). */
  head?: Head | null;
  camStreamId: string | null;
  screenStreamId: string | null;
  /** This browser can show a screen sent encoded-once over a data channel (screencast.ts). */
  castRx?: boolean;
  /** Our screen goes to peers with castRx that way, not as a WebRTC track. */
  screenCast?: boolean;
  /** Our ink colour: a slot in ink.ts's INK_COLORS, unique in the room. */
  ink?: number;
  /** When we joined (our clock, ms): tiles nobody has placed line up in join order. */
  joinedAt?: number;
}

/** What the main stage shows. A peer's screen falls back to their camera when they aren't sharing. */
export type Stage = { kind: 'peer'; id: PeerId; view: 'cam' | 'screen' } | { kind: 'end' };

/** Where the presenter's camera overlay sits when a screen is on stage. */
export type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** The overlay's shape, and whether it's hidden (hiding keeps the last shape). */
export type PipShape = 'rect' | 'square' | 'circle';
export interface PipStyle {
  shape: PipShape;
  hidden: boolean;
}

export interface Take {
  id: string;
  director: PeerId;
  /** Recording start, on the director's clock (ms since epoch). */
  startAt: number;
  /** Recording end, on the director's clock; absent while recording. */
  stopAt?: number;
}

/** Last-writer-wins register. `ts` is a Lamport clock; ties break on `by`. */
export interface Stamped<T> {
  v: T;
  ts: number;
  by: PeerId;
}

export interface SharedState {
  director: Stamped<PeerId | null>;
  /** Tile order; may hold 'end' for where the Multicam tile sits. */
  order: Stamped<(PeerId | 'end')[]>;
  stage: Stamped<Stage | null>;
  take: Stamped<Take | null>;
  corner: Stamped<Corner>;
  pip: Stamped<PipStyle>;
}
export type SharedKey = keyof SharedState;

export interface StageEvent {
  /** ms since take start */
  t: number;
  stage: Stage;
  corner?: Corner;
  pip?: PipStyle;
}

/** A recorded file, as described by the peer that recorded it. */
export interface RecFile {
  name: string;
  peer: PeerId;
  kind: 'cam' | 'screen';
  /** When the file's video timeline starts, in ms since take start (negative: pre-roll). */
  offset: number;
  /** Same for its audio track (differs only for MediaRecorder recordings). */
  audioOffset?: number;
  /** 'capture': exact, from capture timestamps. 'estimated': MediaRecorder fallback. */
  timing?: 'capture' | 'estimated';
  size: number;
  mime: string;
  /** Trimmed to what the edit shows (cut.ts), or final as it is: ready to upload. */
  cut?: boolean;
}

/** The director's view of one peer's upload. */
export interface RaceRow {
  peer: PeerId;
  name: string;
  received: number;
  total: number;
  /** Total is only known once the peer has announced all of its files. */
  announced: boolean;
  done: boolean;
  finishedAt?: number;
  /** Bytes a second over the last few seconds, while it's arriving. */
  rate?: number;
}

/** Everything the compositor needs, saved by the director in OPFS. */
export interface DirectorManifest {
  take: Take;
  stageLog: StageEvent[];
  order: PeerId[];
  profiles: Record<PeerId, Profile>;
  /** Peers that started recording this take. */
  expected: PeerId[];
  files: Record<string, RecFile & { received: number; done: boolean }>;
  announced: PeerId[];
  finishedAt: Record<PeerId, number>;
  rendered?: boolean;
  downloaded?: boolean;
  /** Each person's recording report (devices, encoders, counts, problems), plus 'render'. */
  reports?: Record<string, string[]>;
  /** Per person: stretches (ms since take start) with the camera turned off. */
  camOff?: Record<PeerId, [number, number | null][]>;
  /** Per person: auto-framing anchor changes, [ms since take start, anchor]. */
  frames?: Record<PeerId, [number, Head | null][]>;
}

/** A non-director's record of what it still has to upload. */
export interface SenderManifest {
  take: Take;
  files: RecFile[];
  acked: string[];
  /** Recorders still running (e.g. page reloaded mid-take) aren't listed until they finish. */
  complete: boolean;
  /** What this person's recorders saw: devices, encoders, counts, problems. */
  report?: string[];
  /** Stretches (ms since take start) when this person had their camera off. */
  camOff?: [number, number | null][];
  /** This person's auto-framing anchor changes, [ms since take start, anchor]. */
  frames?: [number, Head | null][];
}

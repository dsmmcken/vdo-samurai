// The animated emoji player, loaded only once a reaction has to be shown (live
// or in the render): ThorVG in wasm (dotlottie-web), drawing an exact frame on
// demand into a small OffscreenCanvas per emoji. Works in a worker too.
import { DotLottie } from '@lottiefiles/dotlottie-web';
import wasm from '@lottiefiles/dotlottie-web/dotlottie-player.wasm?url';

// Our own copy of the wasm, never the player's CDN fallback.
DotLottie.setWasmUrl(new URL(wasm, import.meta.url).href);

interface Player {
  p: DotLottie;
  c: OffscreenCanvas;
  frames: number;
  ms: number;
}

/** One player per emoji, `px` square; `source` gives an emoji's Lottie JSON. */
export class Sprites {
  private players = new Map<string, Player | null>();
  private loading = new Map<string, Promise<void>>();

  constructor(
    private readonly px: number,
    private readonly source: (cp: string) => Promise<string>,
  ) {}

  /** Resolves once `cp` can be drawn (or has failed to load: it's left out). */
  load(cp: string) {
    let l = this.loading.get(cp);
    if (!l) this.loading.set(cp, (l = this.open(cp)));
    return l;
  }

  private async open(cp: string) {
    this.players.set(cp, null);
    try {
      const data = await this.source(cp);
      const c = new OffscreenCanvas(this.px, this.px);
      const p = new DotLottie({ canvas: c, data, autoplay: false, useFrameInterpolation: false, renderConfig: { devicePixelRatio: 1, autoResize: false, freezeOnOffscreen: false } });
      await new Promise<void>((res, rej) => {
        p.addEventListener('load', () => res());
        p.addEventListener('loadError', (e) => rej(e.error));
      });
      this.players.set(cp, { p, c, frames: p.totalFrames, ms: p.duration * 1000 });
    } catch (e) {
      console.warn('[reactions] could not load', cp, e);
    }
  }

  /** The emoji `ms` into its loop; null (and starts loading) until it's ready. A Sprite for drawReactions. */
  sprite = (cp: string, ms: number) => {
    const s = this.players.get(cp);
    if (!s) {
      if (s === undefined) this.load(cp);
      return null;
    }
    s.p.setFrame(Math.floor(((ms % s.ms) / s.ms) * s.frames) % s.frames);
    return s.c;
  };
}

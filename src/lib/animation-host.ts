// Where animation scripts run: a hidden <iframe sandbox="allow-scripts">, so its
// origin is opaque ("null"), plus a Content-Security-Policy that allows no
// network at all. Each animation gets a worker in there (animation-worker.ts), so the
// browser itself keeps scripts away from this app's storage, cookies and pages
// and off the network, and a script stuck in a loop can be terminated (Chrome
// runs the frame in a process of its own). The page talks to each worker over
// a MessagePort it hands in; the frame only starts and stops workers.
//
// The render runs in a worker, which can't make frames: it asks the page
// (serveAnimations) to start sandboxes for it, and talks to them directly.
import { animationWorkerMain } from './animation-worker';

/**
 * No network at all (default-src 'none'). 'unsafe-eval' is only there so the
 * worker can turn the script's text into code; eval and Function are removed
 * before that code runs, and in here they reach nothing anyway.
 */
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:";

/** Runs inside the frame: starts and stops one worker per animation. Self-contained (sent as text). */
function frameMain(workerSource: string) {
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  const workers = new Map<number, Worker>();
  addEventListener('message', (e) => {
    if (e.source !== parent) return;
    const m = e.data;
    if (m?.t === 'spawn' && m.port instanceof MessagePort) {
      try {
        const w = new Worker(url, { name: 'animation' });
        w.onerror = (er) => (er.preventDefault(), parent.postMessage({ t: 'died', id: m.id, message: er.message || 'the animation stopped' }, '*'));
        w.postMessage({ port: m.port }, [m.port]);
        workers.set(m.id, w);
      } catch (err) {
        parent.postMessage({ t: 'died', id: m.id, message: String(err) }, '*');
      }
    } else if (m?.t === 'kill') {
      workers.get(m.id)?.terminate();
      workers.delete(m.id);
    }
  });
  parent.postMessage({ t: 'ready' }, '*');
}

let frame: Promise<Window> | null = null;
const deaths = new Map<number, (message: string) => void>();
let nextId = 1;

function sandboxFrame(): Promise<Window> {
  frame ??= new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.sandbox.add('allow-scripts');
    f.title = 'Animation sandbox';
    f.setAttribute('aria-hidden', 'true');
    f.style.display = 'none';
    const worker = `(${animationWorkerMain.toString()})()`;
    f.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${CSP}"><script>(${frameMain.toString()})(${JSON.stringify(worker).replace(/</g, '\\u003c')})</script>`;
    const timer = setTimeout(() => reject(new Error("The animation sandbox didn't start.")), 10_000);
    addEventListener('message', (e) => {
      if (e.source !== f.contentWindow) return;
      if (e.data?.t === 'ready') {
        clearTimeout(timer);
        resolve(f.contentWindow!);
      } else if (e.data?.t === 'died') deaths.get(e.data.id)?.(String(e.data.message));
    });
    document.body.append(f);
  });
  frame.catch(() => (frame = null)); // try again next time
  return frame;
}

/** How a sandbox is started from here: a worker in the frame, wired to `port`. Returns how to stop it. */
export type Spawn = (port: MessagePort, onDied: (message: string) => void) => Promise<() => void>;

/** On the page: an animation worker in the sandbox frame. */
export const spawnInFrame: Spawn = async (port, onDied) => {
  const win = await sandboxFrame();
  const id = nextId++;
  deaths.set(id, onDied);
  win.postMessage({ t: 'spawn', id, port }, '*', [port]);
  return () => {
    deaths.delete(id);
    win.postMessage({ t: 'kill', id }, '*');
  };
};

/** In a worker (the render): asks the page to start one (see serveAnimations). */
export function spawnViaPage(post: (m: unknown, transfer: Transferable[]) => void, listen: (fn: (m: any) => void) => void): Spawn {
  const died = new Map<number, (message: string) => void>();
  let next = 1;
  listen((m) => m?.t === 'animation-died' && died.get(m.id)?.(String(m.message)));
  return async (port, onDied) => {
    const id = next++;
    died.set(id, onDied);
    post({ t: 'animation-spawn', id, port }, [port]);
    return () => {
      died.delete(id);
      post({ t: 'animation-kill', id }, []);
    };
  };
}

/**
 * On the page, for a worker that needs sandboxes (the render): starts and stops
 * them when it asks. Returns true for the messages it handled.
 */
export function serveAnimations(worker: Worker) {
  const kills = new Map<number, Promise<() => void>>();
  return (m: any) => {
    if (m?.t === 'animation-spawn' && m.port instanceof MessagePort) {
      const id = m.id;
      const kill = spawnInFrame(m.port, (message) => worker.postMessage({ t: 'animation-died', id, message }));
      kill.catch((e) => worker.postMessage({ t: 'animation-died', id, message: (e as Error).message }));
      kills.set(id, kill);
      return true;
    }
    if (m?.t === 'animation-kill') {
      kills.get(m.id)?.then((k) => k(), () => {});
      kills.delete(m.id);
      return true;
    }
    return false;
  };
}

// Opt-in noise reduction for someone's microphone: FastEnhancer
// (fastenhancer-web) in an AudioWorklet at 48 kHz. What it outputs is what
// goes to everyone and into the recording. The model (~1 MB) loads on first
// use, so people who never turn it on never download it.

const KEY = 'samurai:denoise';

/** Whether this browser had noise reduction on last time. */
export function denoisePref(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function setDenoisePref(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export interface Denoised {
  /** The cleaned microphone. Ends when stopped; the original mic stays live. */
  readonly track: MediaStreamTrack;
  stop(): void;
}

/** Downloads and prepares the model; later calls get the same one. */
export async function loadDenoiser() {
  let lib: typeof import('fastenhancer-web');
  try {
    lib = await import('fastenhancer-web');
  } catch {
    // Its files are named by content: after a new deploy (or rebuild) a page
    // loaded before it asks for ones that are gone.
    throw new Error('the app was updated since this page loaded. Reload the page to use it.');
  }
  // 'small': the best of the three, about a third of the audio thread's budget.
  return lib.loadModel('small');
}

export async function denoise(mic: MediaStreamTrack, report: (msg: string) => void): Promise<Denoised> {
  // In the console too: outside a take the report goes nowhere.
  const warn = (msg: string) => (console.warn(`[denoise] ${msg}`), report(msg));
  const model = await loadDenoiser();
  const d = await model.createStreamDenoiser(new MediaStream([mic]), {
    onWarning: warn,
    // Under sustained overload the worklet passes the mic through untouched.
    onAutoBypass: (on) => warn(on ? 'overloaded: passing the mic through unprocessed' : 'processing again'),
  });
  return { track: d.outputStream.getAudioTracks()[0], stop: () => d.destroy() };
}

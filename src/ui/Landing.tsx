import { useRef, useState } from 'react';
import logo from '../assets/logo.svg';
import { Info } from './icons';
import { Popover } from './Popover';

/**
 * Frame for the landing screens (create room, lobby): the logo top left, and
 * bottom right the SDK credit and an (i) with what this is.
 */
export function Landing({ children }: { children: React.ReactNode }) {
  const [about, setAbout] = useState<DOMRect | null>(null);
  const infoRef = useRef<HTMLButtonElement>(null);
  return (
    <main className="home">
      <img className="landing-logo" src={logo} alt="VDO Samurai" />
      {children}
      <button
        ref={infoRef}
        className="glass round landing-info"
        aria-label="About VDO Samurai"
        title="About"
        onClick={() => setAbout(about ? null : infoRef.current!.getBoundingClientRect())}
      >
        <Info size={18} />
      </button>
      {about && (
        <Popover anchor={about} onClose={() => setAbout(null)} align="end">
          <div className="about">
            <p>
              <strong>VDO Samurai is for recording multi-person demos.</strong>
            </p>
            <p>During the call, everyone sees small, lightweight video plus whatever's on the main stage. Meanwhile each browser records its own camera, mic and screen at full quality. When recording stops, those files transfer peer to peer to the director's machine, which renders the final video in high quality.</p>
            <p className="muted">Tested on Chrome.</p>
          </div>
        </Popover>
      )}
      <a className="landing-credit" href="https://github.com/steveseguin/ninjasdk" target="_blank" rel="noopener noreferrer">
        Built with VDO.Ninja SDK
      </a>
    </main>
  );
}

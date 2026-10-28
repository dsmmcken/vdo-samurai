import { useRef, useState } from 'react';
import logo from '../assets/logo.svg';
import { Info } from './icons';
import { Popover } from './Popover';

/**
 * Frame for the landing screens (create room, lobby): the logo top left, an
 * (i) with what this is bottom left, and the SDK credit bottom right.
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
        <Popover anchor={about} onClose={() => setAbout(null)} align="start">
          <div className="about">
            <p>
              <strong>VDO Samurai</strong> is a recording studio in your browser.
            </p>
            <p>The live call uses tiny, low-CPU video. Everyone records full quality on their own machine, uploads it to the director peer to peer when the take ends, and the director’s browser cuts the final video.</p>
            <p className="muted">Chrome recommended.</p>
          </div>
        </Popover>
      )}
      <a className="landing-credit" href="https://github.com/steveseguin/ninjasdk" target="_blank" rel="noopener noreferrer">
        Built with VDO.Ninja SDK
      </a>
    </main>
  );
}

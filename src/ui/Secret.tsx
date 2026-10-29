import { useEffect, useState } from 'react';
import { passwordCheck } from '../lib/passcheck';
import { Eye, EyeOff } from './icons';

/** The invite-link check for a password ('' for none); null while it's hashed. */
export function usePasswordCheck(pw: string) {
  const [check, setCheck] = useState<{ pw: string; check: string } | null>(null);
  useEffect(() => {
    let live = true;
    passwordCheck(pw).then((c) => live && setCheck({ pw, check: c }));
    return () => {
      live = false;
    };
  }, [pw]);
  return check?.pw === pw ? check.check : null;
}

/** Password input with a show/hide eye. */
export function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="secret-input">
      <input {...props} type={shown ? 'text' : 'password'} autoComplete="off" spellCheck={false} />
      <button type="button" className="icon-btn" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'} title={shown ? 'Hide' : 'Show'}>
        {shown ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}

/** A secret shown as dots, with an eye to reveal it. */
export function SecretText({ value }: { value: string }) {
  const [shown, setShown] = useState(false);
  return (
    <span className="secret">
      <span style={{ userSelect: shown ? 'all' : 'none' }}>{shown ? value : '•'.repeat(Math.min(value.length, 12))}</span>
      <button type="button" className="icon-btn" onClick={() => setShown(!shown)} aria-label={shown ? 'Hide password' : 'Show password'} title={shown ? 'Hide' : 'Show'}>
        {shown ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  );
}

import { useState } from 'react';
import type { Profile } from '../lib/types';

/** Name + subtitle editor, shown in a popover. */
export function ProfileForm({ initial, onSave, onCancel }: { initial: Profile; onSave: (p: Profile) => void; onCancel: () => void }) {
  const [p, setP] = useState(initial);
  return (
    <form
      className="stack profile-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ name: p.name.trim(), subtitle: p.subtitle.trim() });
      }}
    >
      <label className="field">
        <span>Full name</span>
        <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} autoFocus />
      </label>
      <label className="field">
        <span>Subtitle</span>
        <input value={p.subtitle} onChange={(e) => setP({ ...p, subtitle: e.target.value })} placeholder="Shown under your name in the final video" />
      </label>
      <div className="row end">
        <button type="button" className="btn ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary sm">
          Save
        </button>
      </div>
    </form>
  );
}

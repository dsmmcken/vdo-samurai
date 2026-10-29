import { useId } from 'react';

/**
 * A small (?) beside a field's label: its hint shows on hover or focus. The
 * hint stays the field's description for screen readers (`id` goes on the
 * input as aria-describedby).
 */
export function Hint({ id, text }: { id: string; text: string }) {
  return (
    <span className="field-hint" tabIndex={0} aria-label="Hint">
      ?
      <span className="field-hint-tip" role="tooltip" id={id}>
        {text}
      </span>
    </span>
  );
}

/** Ids for a field: its input, and its hint. */
export function useFieldIds() {
  const base = useId();
  return { input: `${base}-input`, hint: `${base}-hint` };
}

/** Shown instead of video when someone's camera is off. */
export function Avatar({ name }: { name: string }) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="avatar" aria-label={`${name} (camera off)`}>
      <span>{initials}</span>
    </div>
  );
}

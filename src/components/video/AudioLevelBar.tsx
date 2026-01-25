interface AudioLevelBarProps {
  level: number;
}

function getBarColor(level: number): string {
  if (level > 0.8) return '#ef4444'; // red-500
  if (level >= 0.5) return '#eab308'; // yellow-500
  return '#22c55e'; // green-500
}

export function AudioLevelBar({ level }: AudioLevelBarProps) {
  const color = getBarColor(level);

  return (
    <div className="h-0.5 w-full bg-gray-800 rounded-full overflow-hidden">
      <div
        className="h-full transition-all duration-75"
        style={{
          width: `${level * 100}%`,
          backgroundColor: color
        }}
      />
    </div>
  );
}

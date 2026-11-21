import type { PublicAgent } from '@/lib/api';

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0]];
  return letters.filter(Boolean).join('').toUpperCase() || '?';
}

/** Small round agent photo, or the agent's initials when there is no photo. */
export function AgentAvatar({
  agent,
  size = 28,
}: {
  agent: Pick<PublicAgent, 'id' | 'name' | 'photoVersion'>;
  size?: number;
}) {
  const style = { width: size, height: size };
  if (agent.photoVersion) {
    return (
      <img
        src={`/media/agents/${agent.id}?v=${encodeURIComponent(agent.photoVersion)}`}
        alt={agent.name}
        width={size}
        height={size}
        loading="lazy"
        className="shrink-0 rounded-full border border-border bg-accent object-cover"
        style={style}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary"
      style={{ ...style, fontSize: Math.round(size * 0.38) }}
    >
      {initials(agent.name)}
    </span>
  );
}

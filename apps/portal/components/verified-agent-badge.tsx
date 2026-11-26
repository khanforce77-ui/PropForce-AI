import { ShieldCheck } from 'lucide-react';

/**
 * Shown when PropForce checked the agent's DLD broker card (BRN) and it has not expired. The title
 * says exactly what was checked, so the badge never claims more than that.
 */
export function VerifiedAgentBadge({ compact = false }: { compact?: boolean }) {
  const title =
    'PropForce checked this agent’s DLD broker card (BRN) and identity. The badge goes away when the card expires.';
  if (compact) {
    return (
      <ShieldCheck
        className="h-3.5 w-3.5 shrink-0 text-emerald-600"
        aria-label="Verified agent"
        role="img"
      >
        <title>{title}</title>
      </ShieldCheck>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      title={title}
    >
      <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Verified agent
    </span>
  );
}

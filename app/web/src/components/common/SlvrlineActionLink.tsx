export type SlvrlineAction =
  | "autoStaking"
  | "mining"
  | "staking"
  | "swapBridge";

const ACTIONS: Record<
  SlvrlineAction,
  { href: string; label: string; dot: string; tone: string }
> = {
  autoStaking: {
    href: "https://slvrline.fun/?view=staking&dogfooding=auto-staking",
    label: "Start Auto-Staking",
    dot: "bg-[#a8f0c8] shadow-[0_0_10px_rgba(168,240,200,0.9)]",
    tone:
      "auto-staking-portal-link border-[#a8f0c873] bg-[#a8f0c812] text-[#d7fae7] shadow-[0_0_20px_rgba(168,240,200,0.13)] hover:border-[#c8f7dcba] hover:bg-[#a8f0c81f] hover:text-white hover:shadow-[0_0_28px_rgba(168,240,200,0.24)]",
  },
  mining: {
    href: "https://slvrline.fun/",
    label: "Mine SLVR",
    dot: "bg-[#b9e2ff] shadow-[0_0_9px_rgba(185,226,255,0.85)]",
    tone:
      "mining-portal-link border-[#7eb8e866] bg-[#7eb8e812] text-[#d8edff] shadow-[0_0_18px_rgba(126,184,232,0.12)] hover:border-[#b4deffb8] hover:bg-[#7eb8e81f] hover:text-white hover:shadow-[0_0_26px_rgba(126,184,232,0.22)]",
  },
  staking: {
    href: "https://slvrline.fun/?view=staking",
    label: "Manage Staking",
    dot: "bg-[#f0d8a8]",
    tone:
      "border-[#f0d8a852] bg-[#f0d8a80b] text-[#f5e6c6] hover:border-[#f0d8a88a] hover:bg-[#f0d8a814] hover:text-white",
  },
  swapBridge: {
    href: "https://slvrline.fun/?view=portfolio",
    label: "Swap / Bridge",
    dot: "bg-[#b0b8c8]",
    tone:
      "border-[#b0b8c84d] bg-[#b0b8c80a] text-silver-200 hover:border-[#c8d0e080] hover:bg-[#b0b8c814] hover:text-white",
  },
};

interface SlvrlineActionLinkProps {
  action: SlvrlineAction;
  compact?: boolean;
  label?: string;
  className?: string;
}

export function SlvrlineActionLink({
  action,
  compact = true,
  label,
  className = "",
}: SlvrlineActionLinkProps) {
  const meta = ACTIONS[action];
  const visibleLabel = label ?? meta.label;

  return (
    <a
      href={meta.href}
      target="_blank"
      rel="noopener noreferrer"
      className={`group relative inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-md border font-semibold no-underline transition duration-200 hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a8f0c880] ${
        compact
          ? "min-h-9 px-2.5 py-1.5 text-[0.75rem]"
          : "min-h-10 px-3.5 py-2 text-[0.8125rem]"
      } ${meta.tone} ${className}`}
      aria-label={`${visibleLabel} on slvrline.fun in a new tab`}
    >
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`}
        aria-hidden
      />
      <span>{visibleLabel}</span>
      <span
        className="transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        aria-hidden
      >
        ↗
      </span>
    </a>
  );
}

interface SlvrlineActionsProps {
  actions: SlvrlineAction[];
  compact?: boolean;
  className?: string;
}

export function SlvrlineActions({
  actions,
  compact = true,
  className = "",
}: SlvrlineActionsProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {actions.map((action) => (
        <SlvrlineActionLink
          key={action}
          action={action}
          compact={compact}
        />
      ))}
    </div>
  );
}

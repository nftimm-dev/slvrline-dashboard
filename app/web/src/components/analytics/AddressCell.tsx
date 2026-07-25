import { getLabel, getBlockscoutUrl } from "@/lib/labels";
import { ExternalLink } from "lucide-react";

interface AddressCellProps {
  address: string;
  /** Prefer a server-provided label; falls back to the local registry. */
  label?: string | null;
  /** Show a small "contract" tag. */
  isContract?: boolean;
  showFull?: boolean;
}

/**
 * Compact address display for tables: optional human label, short mono hash,
 * a subtle "contract" tag when applicable, linked to Blockscout.
 */
export default function AddressCell({
  address,
  label,
  isContract = false,
  showFull = false,
}: AddressCellProps) {
  const resolved = label ?? getLabel(address);
  const url = getBlockscoutUrl(address);
  const short = showFull
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          color: "var(--color-accent)",
          textDecoration: "none",
        }}
      >
        {resolved && (
          <span style={{ fontWeight: 500, fontSize: "0.8125rem" }}>
            {resolved}
          </span>
        )}
        <code
          style={{
            fontSize: "0.6875rem",
            color: resolved ? "var(--color-silver-400)" : "var(--color-silver-300)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {short}
        </code>
        <ExternalLink
          style={{ width: 11, height: 11, color: "var(--color-silver-400)" }}
        />
      </a>
      {isContract && (
        <span
          style={{
            fontSize: "0.5625rem",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--color-silver-400)",
            border: "1px solid var(--color-silver-700)",
            borderRadius: 4,
            padding: "1px 5px",
            fontWeight: 600,
            lineHeight: 1.4,
          }}
        >
          contract
        </span>
      )}
    </span>
  );
}

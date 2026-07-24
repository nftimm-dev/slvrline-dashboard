import { getLabel, getBlockscoutUrl } from "@/lib/labels";
import { ExternalLink } from "lucide-react";

interface AddressLabelProps {
  address: string;
  showFull?: boolean;
  className?: string;
}

export default function AddressLabel({
  address,
  showFull = false,
  className = "",
}: AddressLabelProps) {
  const label = getLabel(address);
  const url = getBlockscoutUrl(address);
  const displayAddress = showFull
    ? address
    : `${address.slice(0, 6)}…${address.slice(-4)}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        color: "var(--color-accent)",
        textDecoration: "none",
      }}
    >
      {label && (
        <span style={{ fontWeight: 500, fontSize: "0.8125rem" }}>{label}</span>
      )}
      <code
        style={{
          fontSize: "0.6875rem",
          color: "var(--color-silver-400)",
          fontFamily: "var(--font-mono)",
        }}
      >
        {displayAddress}
      </code>
      <ExternalLink
        style={{ width: 11, height: 11, color: "var(--color-silver-400)" }}
      />
    </a>
  );
}

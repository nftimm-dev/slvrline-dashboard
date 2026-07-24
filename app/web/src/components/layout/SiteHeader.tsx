"use client";

import Link from "next/link";
import PageContainer from "./PageContainer";
import StatusDot from "@/components/vitals/StatusDot";

export default function SiteHeader() {
  return (
    <header
      className="h-12 border-b w-full sticky top-0 z-50"
      style={{
        borderBottomColor: "var(--color-silver-800)",
        backgroundColor: "var(--color-silver-950)",
      }}
    >
      <PageContainer className="h-full flex items-center justify-between">
        {/* Wordmark */}
        <Link
          href="/"
          className="flex items-center gap-1 no-underline"
          style={{ textDecoration: "none" }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "var(--color-accent)",
              fontWeight: 600,
            }}
          >
            //
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              color: "var(--color-silver-100)",
              fontWeight: 600,
            }}
          >
            SLVRline
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex items-center gap-4">
          <Link
            href="/methodology"
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-silver-400)",
              textDecoration: "none",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.color =
                "var(--color-silver-200)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.color =
                "var(--color-silver-400)")
            }
          >
            Methodology
          </Link>
          <a
            href="https://robinhoodchain.blockscout.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: "0.8125rem",
              color: "var(--color-silver-400)",
              textDecoration: "none",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.color =
                "var(--color-silver-200)")
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLAnchorElement).style.color =
                "var(--color-silver-400)")
            }
          >
            Blockscout
          </a>
          <StatusDot />
        </nav>
      </PageContainer>
    </header>
  );
}

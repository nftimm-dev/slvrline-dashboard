"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import PageContainer from "./layout/PageContainer";
import StatusDot from "@/components/vitals/StatusDot";
import { SlvrlineActionLink } from "@/components/common/SlvrlineActionLink";

interface NavLink {
  href: string;
  label: string;
}

const NAV_LINKS: NavLink[] = [
  { href: "/", label: "Overview" },
  { href: "/earn", label: "Earn" },
  { href: "/staking", label: "Staking" },
  { href: "/holders", label: "Holders" },
  { href: "/markets", label: "Markets" },
  { href: "/mining", label: "Mining" },
  { href: "/methodology", label: "Methodology" },
];

/**
 * isActive — exact match for "/" (Overview), prefix match for the rest so that
 * nested routes still highlight their section.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export default function SiteNav() {
  const pathname = usePathname() ?? "/";

  return (
    <header
      className="border-b w-full sticky top-0 z-50"
      style={{
        borderBottomColor: "var(--color-silver-800)",
        backgroundColor: "var(--color-silver-950)",
      }}
    >
      <PageContainer className="h-12 flex items-center gap-4">
        {/* Primary SLVRline identity — shared with slvrline.fun */}
        <Link
          href="/"
          className="flex items-center gap-2 no-underline flex-shrink-0"
          style={{ textDecoration: "none" }}
          aria-label="SLVRline Analytics home"
        >
          <img
            src="/slvrline-logo.png"
            alt="SLVRline"
            width={720}
            height={116}
            className="h-[24px] w-[150px] object-contain"
          />
          <span
            className="hidden border-l pl-2 font-mono uppercase sm:inline"
            style={{
              borderColor: "var(--color-silver-700)",
              fontSize: "0.5625rem",
              letterSpacing: "0.12em",
              color: "var(--color-silver-400)",
              fontWeight: 600,
            }}
          >
            Analytics
          </span>
        </Link>

        {/* Nav — scrolls horizontally on narrow viewports rather than wrapping the bar */}
        <nav
          className="flex items-center gap-1 ml-auto overflow-x-auto site-nav-scroll"
          style={{ scrollbarWidth: "none" }}
        >
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className="no-underline whitespace-nowrap"
                style={{
                  fontSize: "0.8125rem",
                  padding: "4px 8px",
                  borderRadius: "var(--radius-chip)",
                  color: active
                    ? "var(--color-silver-100)"
                    : "var(--color-silver-400)",
                  backgroundColor: active
                    ? "var(--color-silver-800)"
                    : "transparent",
                  textDecoration: "none",
                  fontWeight: active ? 600 : 400,
                  transition: "color 0.15s, background-color 0.15s",
                }}
              >
                {link.label}
              </Link>
            );
          })}

          <a
            href="https://robinhoodchain.blockscout.com"
            target="_blank"
            rel="noopener noreferrer"
            className="no-underline whitespace-nowrap"
            style={{
              fontSize: "0.8125rem",
              padding: "4px 8px",
              color: "var(--color-silver-400)",
              textDecoration: "none",
            }}
          >
            Blockscout
          </a>

          <SlvrlineActionLink
            action="autoStaking"
            label="Auto-Stake"
            className="whitespace-nowrap"
          />
          <SlvrlineActionLink
            action="mining"
            className="whitespace-nowrap"
          />

          <span className="pl-1 pr-1 flex items-center flex-shrink-0">
            <StatusDot />
          </span>
        </nav>
      </PageContainer>

      <style>{`
        .site-nav-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>
    </header>
  );
}

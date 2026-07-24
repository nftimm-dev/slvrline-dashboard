import Link from "next/link";
import PageContainer from "./PageContainer";
import AddressLabel from "@/components/common/AddressLabel";

export default function SiteFooter() {
  return (
    <footer
      className="mt-16 py-8 border-t"
      style={{ borderTopColor: "var(--color-silver-800)" }}
    >
      <PageContainer>
        <div className="flex flex-col gap-3">
          <p style={{ fontSize: "0.8125rem", color: "var(--color-silver-400)" }}>
            Independent source of truth — computed from indexed Robinhood Chain
            data.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <span
              style={{ fontSize: "0.75rem", color: "var(--color-silver-400)" }}
            >
              SLVR Token:
            </span>
            <AddressLabel address="0x791229E3EbD6CFdC3D8157f48722684173C29aD9" />
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-1">
            <Link
              href="/methodology"
              style={{
                fontSize: "0.75rem",
                color: "var(--color-accent)",
                textDecoration: "none",
              }}
            >
              Methodology
            </Link>
            <span
              style={{ fontSize: "0.75rem", color: "var(--color-silver-700)" }}
            >
              ·
            </span>
            <span
              style={{ fontSize: "0.75rem", color: "var(--color-silver-400)" }}
            >
              Not affiliated with slvr.fun
            </span>
          </div>
        </div>
      </PageContainer>
    </footer>
  );
}

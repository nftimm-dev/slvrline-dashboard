/**
 * Placeholder home page.
 * Phase 5 will replace this with the full analytics dashboard.
 */
export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 640,
        margin: "80px auto",
        padding: "0 24px",
        color: "#1a1a1a",
      }}
    >
      <h1 style={{ fontSize: 32, fontWeight: 700 }}>SLVRline</h1>
      <p style={{ color: "#6c757d", marginTop: 8 }}>
        SLVR Protocol Analytics — API Layer Active
      </p>
      <ul
        style={{
          marginTop: 32,
          listStyle: "none",
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {["/api/vitals", "/api/market", "/api/status"].map((path) => (
          <li key={path}>
            <a
              href={path}
              style={{ color: "#0070f3", textDecoration: "none" }}
            >
              {path}
            </a>
          </li>
        ))}
        <li>
          <a
            href="/api/history?metric=dividends_apr&range=7d"
            style={{ color: "#0070f3", textDecoration: "none" }}
          >
            /api/history?metric=dividends_apr&range=7d
          </a>
        </li>
      </ul>
      <p style={{ marginTop: 48, fontSize: 13, color: "#adb5bd" }}>
        Phase 5 dashboard coming soon.
      </p>
    </main>
  );
}

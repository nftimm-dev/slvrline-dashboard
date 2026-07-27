import { ImageResponse } from "next/og";

export const alt =
  "SLVRline advanced protocol analytics for SLVR on Robinhood Chain";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background:
            "radial-gradient(circle at 80% 18%, rgba(126, 184, 232, 0.24), transparent 34%), linear-gradient(135deg, #07090d 0%, #0b1017 58%, #07111a 100%)",
          color: "#eef5fb",
          display: "flex",
          height: "100%",
          overflow: "hidden",
          position: "relative",
          width: "100%",
        }}
      >
        <div
          style={{
            backgroundImage:
              "linear-gradient(rgba(126, 184, 232, 0.09) 1px, transparent 1px), linear-gradient(90deg, rgba(126, 184, 232, 0.09) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            display: "flex",
            height: "100%",
            left: 0,
            maskImage:
              "linear-gradient(to right, rgba(0,0,0,0.7), transparent 92%)",
            position: "absolute",
            top: 0,
            width: "100%",
          }}
        />

        <svg
          width="530"
          height="300"
          viewBox="0 0 530 300"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{
            bottom: 54,
            opacity: 0.9,
            position: "absolute",
            right: 20,
          }}
        >
          <path
            d="M14 242 C 62 232, 70 170, 120 184 S 198 230, 244 151 S 322 97, 356 116 S 418 87, 508 31"
            stroke="#7EB8E8"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <path
            d="M14 242 C 62 232, 70 170, 120 184 S 198 230, 244 151 S 322 97, 356 116 S 418 87, 508 31 L508 290 L14 290 Z"
            fill="url(#area)"
          />
          <circle cx="508" cy="31" r="10" fill="#B9E2FF" />
          <circle
            cx="508"
            cy="31"
            r="20"
            stroke="#7EB8E8"
            strokeOpacity="0.45"
            strokeWidth="3"
          />
          <defs>
            <linearGradient
              id="area"
              x1="260"
              y1="31"
              x2="260"
              y2="290"
              gradientUnits="userSpaceOnUse"
            >
              <stop stopColor="#7EB8E8" stopOpacity="0.34" />
              <stop offset="1" stopColor="#7EB8E8" stopOpacity="0" />
            </linearGradient>
          </defs>
        </svg>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            justifyContent: "space-between",
            padding: "58px 68px 54px",
            position: "relative",
            width: "100%",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
            }}
          >
            <div style={{ alignItems: "center", display: "flex", gap: 14 }}>
              <svg
                width="76"
                height="62"
                viewBox="0 0 76 62"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10 10V52H66"
                  stroke="#00F783"
                  strokeWidth="8"
                  strokeLinecap="square"
                  strokeLinejoin="miter"
                />
                <path
                  d="M20 43L34 27L45 36L64 13"
                  stroke="#00F783"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M53 13H64V24"
                  stroke="#00F783"
                  strokeWidth="6"
                  strokeLinecap="square"
                  strokeLinejoin="miter"
                />
              </svg>
              <div
                style={{
                  alignItems: "baseline",
                  display: "flex",
                  fontSize: 40,
                  letterSpacing: "-2px",
                }}
              >
                <span style={{ color: "#B8B8B8", fontWeight: 900 }}>SLVR</span>
                <span style={{ color: "#00F783", fontWeight: 800 }}>line</span>
              </div>
              <span
                style={{
                  borderLeft: "1px solid rgba(126, 184, 232, 0.35)",
                  color: "#8bc7f5",
                  display: "flex",
                  fontFamily: "monospace",
                  fontSize: 14,
                  fontWeight: 700,
                  letterSpacing: "2px",
                  paddingLeft: 14,
                }}
              >
                ANALYTICS
              </span>
            </div>
            <div
              style={{
                alignItems: "center",
                border: "1px solid rgba(126, 184, 232, 0.45)",
                borderRadius: 999,
                color: "#B9E2FF",
                display: "flex",
                fontSize: 16,
                fontWeight: 700,
                gap: 10,
                letterSpacing: "2px",
                padding: "12px 18px",
              }}
            >
              <span
                style={{
                  background: "#B9E2FF",
                  borderRadius: 999,
                  boxShadow: "0 0 14px rgba(185, 226, 255, 0.9)",
                  display: "flex",
                  height: 9,
                  width: 9,
                }}
              />
              LIVE DATA
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 20,
              marginBottom: 24,
            }}
          >
            <div
              style={{
                color: "#8bc7f5",
                display: "flex",
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: "5px",
              }}
            >
              ADVANCED PROTOCOL ANALYTICS
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                fontSize: 68,
                fontWeight: 760,
                letterSpacing: "-3px",
                lineHeight: 1.03,
                maxWidth: 810,
              }}
            >
              <span>Follow the capital.</span>
              <span style={{ color: "#9cb0c1" }}>Read the protocol.</span>
            </div>
            <div
              style={{
                color: "#9cb0c1",
                display: "flex",
                fontSize: 24,
                lineHeight: 1.35,
                maxWidth: 730,
              }}
            >
              Independent mining, staking, holders, liquidity, and RWA
              intelligence for SLVR on Robinhood Chain.
            </div>
          </div>

          <div
            style={{
              alignItems: "center",
              borderTop: "1px solid rgba(126, 184, 232, 0.23)",
              color: "#71889b",
              display: "flex",
              fontSize: 16,
              justifyContent: "space-between",
              letterSpacing: "2px",
              paddingTop: 22,
            }}
          >
            <span>ANALYTICS.SLVRLINE.FUN</span>
            <span>MINING • STAKING • MARKETS • RWA</span>
          </div>
        </div>
      </div>
    ),
    size
  );
}

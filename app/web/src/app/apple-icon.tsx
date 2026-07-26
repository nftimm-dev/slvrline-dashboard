import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "center",
          background: "#050607",
          display: "flex",
          height: "100%",
          justifyContent: "center",
          width: "100%",
        }}
      >
        <svg
          width="180"
          height="180"
          viewBox="0 0 180 180"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x="8"
            y="8"
            width="164"
            height="164"
            rx="40"
            fill="#0A0B0D"
            stroke="#3D4654"
            strokeWidth="5"
          />
          <path
            d="M40 40V140M73 40V140M106 40V140M140 40V140M40 40H140M40 73H140M40 106H140M40 140H140"
            stroke="#77818F"
            strokeOpacity="0.28"
            strokeWidth="4"
          />
          <path
            d="M37 129L70 93L98 110L141 47"
            stroke="#E8EAED"
            strokeWidth="11"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="141" cy="47" r="14" fill="#00C805" />
          <circle
            cx="141"
            cy="47"
            r="23"
            stroke="#00C805"
            strokeOpacity="0.28"
            strokeWidth="5"
          />
        </svg>
      </div>
    ),
    size
  );
}

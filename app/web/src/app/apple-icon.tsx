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
            stroke="#00F783"
            strokeOpacity="0.34"
            strokeWidth="5"
          />
          <path
            d="M40 42V138H140"
            stroke="#00F783"
            strokeWidth="14"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
          <path
            d="M54 118L82 84L103 101L138 58"
            stroke="#00F783"
            strokeWidth="13"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M119 58H138V77"
            stroke="#00F783"
            strokeWidth="13"
            strokeLinecap="square"
            strokeLinejoin="miter"
          />
        </svg>
      </div>
    ),
    size
  );
}

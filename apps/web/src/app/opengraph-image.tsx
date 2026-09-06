import { ImageResponse } from "next/og";

export const runtime = "edge";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#0a1a3a",
          color: "#ffffff",
        }}
      >
        <div style={{ fontSize: 96, fontWeight: 700 }}>Nicotine Hub</div>
        <div style={{ fontSize: 40, opacity: 0.8 }}>Soulseek web client in your browser</div>
      </div>
    ),
    { ...size },
  );
}

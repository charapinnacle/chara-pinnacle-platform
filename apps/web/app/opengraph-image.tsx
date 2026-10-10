import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "CHARA Pinnacle";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Colours are the hex values of --inverse-foreground and --brand: the renderer cannot read the CSS tokens. The ground is
// the pure black of the monogram file, so the monogram has no visible edge. The type is Geist, which next/og bundles.
export default async function Image() {
  const monogram = await readFile(join(process.cwd(), "public/brand/cp-monogram-512.png"));
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", alignItems: "center", justifyContent: "center", gap: 56, background: "#000" }}>
        <img src={`data:image/png;base64,${monogram.toString("base64")}`} width={280} height={280} alt="" />
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <span style={{ fontSize: 120, lineHeight: 1, letterSpacing: "0.24em", color: "#f6f5f2" }}>CHARA</span>
          <span style={{ fontSize: 38, lineHeight: 1, letterSpacing: "0.32em", color: "#c9973d" }}>PINNACLE</span>
        </div>
      </div>
    ),
    size,
  );
}

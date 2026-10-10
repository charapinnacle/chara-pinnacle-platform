import { Geist } from "next/font/google";

// Served from our own origin at build time (font-src 'self'); latin-ext covers the names of European candidates.
export const geist = Geist({ subsets: ["latin", "latin-ext"], variable: "--font-geist", display: "swap" });

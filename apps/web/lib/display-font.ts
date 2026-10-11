import { Newsreader } from "next/font/google";

// The serif of the display headings of the home page (design token --font-serif): one weight and the Latin subset only,
// because it sets fixed English headings and figures, never a name. It lives in a module of its own that only the home page
// imports, because next/font preloads every font of a module for each route that uses the module: so no other page preloads
// it. next/font gives it a size-adjusted fallback, so the swap moves nothing.
export const newsreader = Newsreader({ subsets: ["latin"], weight: "400", variable: "--font-newsreader", display: "swap" });

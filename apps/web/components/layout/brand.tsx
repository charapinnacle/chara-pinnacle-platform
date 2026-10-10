import Link from "next/link";
import { cn } from "@/lib/utils";

// The gold CP monogram as CHARA supplied it, on its own black ground. It sits only on dark surfaces or as its own dark
// tile; the files are ready-sized WebP, so they are served as they are. It is decoration beside the wordmark, so it is a
// background image: next/image writes a style attribute, which the CSP blocks (style-src-attr).
export function BrandMark({ size = "sm", className }: { size?: "sm" | "lg"; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block shrink-0 bg-cover ring-1 ring-black/5",
        size === "lg"
          ? "size-14 rounded-2xl bg-[url(/brand/cp-monogram-512.webp)]"
          : "size-8 rounded-lg bg-[url(/brand/cp-monogram-128.webp)]",
        className,
      )}
    />
  );
}

type BrandLinkProps = {
  href: string;
  // Pinnacle is set under the wordmark where there is room for it (the sidebar).
  subline?: boolean;
  tone?: "default" | "inverse";
  className?: string;
};

// The way home: the monogram tile and the CHARA wordmark. The accessible name is the wordmark.
export function BrandLink({ href, subline = false, tone = "default", className }: BrandLinkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "-mx-1.5 inline-flex min-h-11 items-center gap-3 rounded-lg px-1.5 transition-opacity duration-150 hover:opacity-80",
        className,
      )}
    >
      <BrandMark />
      <Wordmark subline={subline} tone={tone} />
    </Link>
  );
}

export function Wordmark({ subline = false, tone = "default" }: Pick<BrandLinkProps, "subline" | "tone">) {
  return (
    <span className="grid leading-none">
      <span className={cn("text-body font-semibold tracking-[0.24em]", tone === "inverse" ? "text-inverse-foreground" : "text-foreground")}>
        CHARA
      </span>
      {subline ? (
        <span className={cn("mt-1 text-caption tracking-[0.32em] uppercase", tone === "inverse" ? "text-brand" : "text-brand-ink")}>
          Pinnacle
        </span>
      ) : null}
    </span>
  );
}

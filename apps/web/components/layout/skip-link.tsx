export const MAIN_CONTENT_ID = "main-content";

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only rounded-lg bg-card text-small font-medium text-foreground shadow-card focus:not-sr-only focus:px-4 focus:py-2.5 focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:outline-2 focus:outline-ring"
    >
      Skip to main content
    </a>
  );
}

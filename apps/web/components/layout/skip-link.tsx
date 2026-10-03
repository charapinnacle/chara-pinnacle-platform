export const MAIN_CONTENT_ID = "main-content";

export function SkipLink() {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      className="sr-only rounded-md bg-background text-sm font-medium focus:not-sr-only focus:px-4 focus:py-2 focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:outline-2 focus:outline-ring"
    >
      Skip to main content
    </a>
  );
}

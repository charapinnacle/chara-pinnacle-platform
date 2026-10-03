// A Server Action that calls redirect() rejects the promise the client awaits with a redirect
// error after Next has already started the navigation; it is not a failure to report.
export function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT;")
  );
}

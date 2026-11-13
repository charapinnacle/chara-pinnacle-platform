// What the header bell needs and nothing else, so the list's presenters stay out of the chunk every signed-in page loads.

// How often the bell asks for the unread count while the Realtime channel is not connected.
export const UNREAD_POLL_MS = 60_000;

// The accessible name of the header bell (FR-T1 AC9).
export function bellLabel(unread: number): string {
  return unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
}

export function badgeText(unread: number): string {
  return unread > 99 ? "99+" : String(unread);
}

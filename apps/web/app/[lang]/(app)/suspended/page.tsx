import type { Metadata } from "next";

export const metadata: Metadata = { title: "Account suspended — CHARA", robots: { index: false } };

export default function SuspendedPage() {
  return (
    <div className="grid max-w-xl gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">Your account is suspended</h1>
      <p>See the email we sent you for the reasons and how to respond.</p>
    </div>
  );
}

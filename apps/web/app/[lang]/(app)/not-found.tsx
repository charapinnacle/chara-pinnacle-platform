import type { Metadata } from "next";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";

export const metadata: Metadata = { title: "Page not found — CHARA" };

export default function NotFound() {
  return (
    <AuthCard title="Page not found">
      <TextLink standalone="flush" href="/">
        Back to the home page
      </TextLink>
    </AuthCard>
  );
}

import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { TextLink } from "@/components/forms/text-link";
import { AuthCard } from "@/components/layout/auth-card";

export const metadata: Metadata = { title: "Log in — CHARA" };

export default async function LoginPage({
  params,
  searchParams,
}: PageProps<"/[lang]/login">) {
  const [{ lang }, { next }] = await Promise.all([params, searchParams]);
  return (
    <AuthCard
      title="Log in"
      footer={
        <p className="flex flex-wrap items-center gap-x-1.5">
          New to CHARA?
          <TextLink standalone="flush" href={`/${lang}/signup`}>
            Create an account
          </TextLink>
        </p>
      }
    >
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </AuthCard>
  );
}

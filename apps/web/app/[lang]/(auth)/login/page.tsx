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
        <>
          New to CHARA? <TextLink href={`/${lang}/signup`}>Create an account</TextLink>
        </>
      }
    >
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </AuthCard>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Log in — CHARA" };

export default async function LoginPage({
  params,
  searchParams,
}: PageProps<"/[lang]/login">) {
  const [{ lang }, { next }] = await Promise.all([params, searchParams]);
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>
      <LoginForm next={typeof next === "string" ? next : undefined} />
      <p className="text-sm text-muted-foreground">
        New to CHARA?{" "}
        <Link href={`/${lang}/signup`} className="underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  );
}

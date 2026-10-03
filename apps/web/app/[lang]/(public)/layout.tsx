import { SiteShell } from "@/components/layout/site-shell";

export default function PublicLayout({ children }: LayoutProps<"/[lang]">) {
  return <SiteShell>{children}</SiteShell>;
}

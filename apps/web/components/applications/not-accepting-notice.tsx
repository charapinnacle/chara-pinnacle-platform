import { Notice } from "@/components/forms/notice";
import { TextLink } from "@/components/forms/text-link";
import { NOT_ACCEPTING } from "@/lib/applications/presentation";

export function NotAcceptingNotice({ lang }: { lang: string }) {
  return (
    <Notice tone="error" role="alert" className="grid gap-2">
      <p className="font-semibold">{NOT_ACCEPTING}</p>
      <TextLink standalone href={`/${lang}/jobs`}>
        Find vacancies
      </TextLink>
    </Notice>
  );
}

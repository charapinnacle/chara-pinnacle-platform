import { cva, type VariantProps } from "class-variance-authority";
import Link from "next/link";
import { defaultLocale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";

const standaloneBase = "inline-flex min-h-11 items-center justify-self-start text-body";

const textLinkVariants = cva(
  "-mx-0.5 rounded-sm px-0.5 font-medium underline decoration-[1.5px] underline-offset-4 transition-colors duration-150",
  {
    variants: {
      tone: {
        primary: "text-foreground decoration-brand hover:decoration-foreground",
        destructive: "text-destructive decoration-destructive/40 hover:decoration-destructive",
      },
      standalone: {
        true: standaloneBase,
        flush: `${standaloneBase} -my-3`,
        center: `${standaloneBase} justify-self-center`,
      },
    },
    defaultVariants: { tone: "primary" },
  },
);

type TextLinkProps = React.ComponentProps<typeof Link> & VariantProps<typeof textLinkVariants>;

export function TextLink({ tone, standalone, className, ...props }: TextLinkProps) {
  return <Link className={cn(textLinkVariants({ tone, standalone }), className)} {...props} />;
}

export const COMPLAINTS_SLUG = "complaints-and-dispute-process";

type LegalLinkProps = Pick<TextLinkProps, "standalone" | "className" | "children"> & {
  slug: string;
  newTabLabel: string;
};

export function LegalLink({ slug, newTabLabel, standalone, className, children }: LegalLinkProps) {
  return (
    <TextLink
      href={`/${defaultLocale}/legal/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      prefetch={false}
      standalone={standalone}
      className={className}
    >
      {children}
      <span className="sr-only"> {newTabLabel}</span>
    </TextLink>
  );
}

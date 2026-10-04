import { cva, type VariantProps } from "class-variance-authority";
import { defaultLocale } from "@/lib/i18n/locale";
import { cn } from "@/lib/utils";

const textLinkVariants = cva(
  "-mx-0.5 rounded-sm px-0.5 font-medium underline underline-offset-4",
  {
    variants: {
      tone: {
        primary: "text-primary decoration-primary/40 hover:decoration-primary",
        destructive: "text-destructive decoration-destructive/40 hover:decoration-destructive",
      },
    },
    defaultVariants: { tone: "primary" },
  },
);

type TextLinkProps = React.ComponentProps<"a"> & VariantProps<typeof textLinkVariants>;

export function TextLink({ tone, className, ...props }: TextLinkProps) {
  return <a className={cn(textLinkVariants({ tone }), className)} {...props} />;
}

type LegalLinkProps = {
  slug: string;
  newTabLabel: string;
  className?: string;
  children: React.ReactNode;
};

export function LegalLink({ slug, newTabLabel, className, children }: LegalLinkProps) {
  return (
    <TextLink
      href={`/${defaultLocale}/legal/${slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
      <span className="sr-only"> {newTabLabel}</span>
    </TextLink>
  );
}

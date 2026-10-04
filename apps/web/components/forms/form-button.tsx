import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FormButtonProps = Omit<React.ComponentProps<typeof Button>, "size"> & {
  busy?: boolean;
};

export function FormButton({ busy = false, disabled, className, ...props }: FormButtonProps) {
  return (
    <Button
      size="lg"
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        "w-full font-semibold shadow-xs transition-[background-color,box-shadow] hover:bg-primary-hover hover:shadow-sm focus-visible:ring-0 active:bg-primary-active",
        busy
          ? "disabled:pointer-events-auto disabled:cursor-progress disabled:bg-primary-hover disabled:opacity-100"
          : "disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

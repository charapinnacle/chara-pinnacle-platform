import { RemoveButton } from "@/components/passport/remove-button";

type ListRowProps = React.ComponentProps<typeof RemoveButton> & { children: React.ReactNode };

export function ListRow({ children, ...remove }: ListRowProps) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-1.5">
      <span className="min-w-0 break-words">{children}</span>
      <RemoveButton {...remove} />
    </li>
  );
}

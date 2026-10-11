import { Card } from "@/components/layout/card";
import { cn } from "@/lib/utils";

export const cell = "px-3 py-3 align-top";
export const headCell = "px-3 py-2 text-start font-medium";

type ResultsTableProps = { caption: string; columns: readonly string[]; children: React.ReactNode; narrow?: boolean };

// A wide table scrolls sideways on a phone, which a keyboard can follow through the links of its rows. A narrow table of
// plain text has no such link, so it keeps no minimum width and fits the screen instead of scrolling (WCAG 2.1.1).
export function ResultsTable({ caption, columns, children, narrow = false }: ResultsTableProps) {
  return (
    <Card padding="none" className="relative block overflow-x-auto">
      <table className={cn("w-full text-body", !narrow && "min-w-[32rem]")}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b">
            {columns.map((column) => (
              <th key={column} scope="col" className={headCell}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </Card>
  );
}

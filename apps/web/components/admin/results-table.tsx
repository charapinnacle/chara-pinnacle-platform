export const cell = "px-3 py-3 align-top";
export const headCell = "px-3 py-2 text-start font-medium";

export function ResultsTable({ caption, columns, children }: { caption: string; columns: readonly string[]; children: React.ReactNode }) {
  return (
    <div className="relative overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[32rem] text-body">
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
    </div>
  );
}

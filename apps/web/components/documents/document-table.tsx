import { DocumentRow } from "@/components/documents/document-row";
import type { DocumentItem } from "@/lib/documents/fetch-documents";

type DocumentTableProps = { items: DocumentItem[]; today: string; checking: readonly string[]; onChanged: () => void };

export function DocumentTable({ items, today, checking, onChanged }: DocumentTableProps) {
  return (
    <div className="relative overflow-x-auto rounded-lg border">
      <table className="w-full text-start text-body">
        <caption className="sr-only">Your documents, newest first</caption>
        <thead className="bg-muted/50 text-start text-sm">
          <tr>
            {["Title", "Type", "Size", "Uploaded", "Expires", "Status"].map((heading) => (
              <th key={heading} scope="col" className="px-3 py-2 text-start font-semibold">
                {heading}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-start font-semibold">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <DocumentRow
              key={item.id}
              item={item}
              today={today}
              checking={checking.includes(item.id)}
              onChanged={onChanged}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

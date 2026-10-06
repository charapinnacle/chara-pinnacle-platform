import { DocumentRow } from "@/components/documents/document-row";
import type { DocumentItem } from "@/lib/documents/fetch-documents";

type DocumentTableProps = { items: DocumentItem[]; today: string; onChanged: () => void };

export function DocumentTable({ items, today, onChanged }: DocumentTableProps) {
  return (
    <div className="relative overflow-x-auto rounded-lg border">
      <table role="table" className="block w-full text-start text-body">
        <caption className="sr-only">Your documents, newest first</caption>
        <thead role="rowgroup" className="sr-only">
          <tr role="row">
            {["Title", "Type", "Size", "Uploaded", "Expires", "Status"].map((heading) => (
              <th key={heading} role="columnheader" scope="col">
                {heading}
              </th>
            ))}
            <th role="columnheader" scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody role="rowgroup" className="block">
          {items.map((item) => (
            <DocumentRow key={item.id} item={item} today={today} onChanged={onChanged} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

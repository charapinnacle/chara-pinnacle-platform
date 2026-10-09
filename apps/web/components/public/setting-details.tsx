import { DetailList } from "@/components/admin/detail-list";
import type { SettingRow } from "@/lib/public/setting-rows";

export function SettingDetails({ rows }: { rows: readonly SettingRow[] }) {
  if (rows.length === 0) return <p className="text-muted-foreground">These details are being completed.</p>;
  return (
    <DetailList
      items={rows.map(({ label, value, mailto }) => ({
        label,
        value: mailto ? (
          <a href={mailto} className="font-medium text-primary underline underline-offset-4">
            {value}
          </a>
        ) : (
          <span className="whitespace-pre-line">{value}</span>
        ),
      }))}
    />
  );
}

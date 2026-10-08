export function DetailList({ items }: { items: readonly { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
      {items.map(({ label, value }) => (
        <div key={label} className="grid gap-1 sm:contents">
          <dt className="font-medium text-muted-foreground">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PageHeading({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <header className="grid gap-1">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h1>
      {children}
    </header>
  );
}

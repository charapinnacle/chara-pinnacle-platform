// The share of one stage as a bar beside its number. The number in the cell is the value; the bar repeats it for the eye
// only. SVG attributes, not a style attribute, set the width (the CSP allows no inline style).
export function StageBar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.max((value / max) * 100, value > 0 ? 3 : 0) : 0;
  return (
    <svg aria-hidden viewBox="0 0 100 6" preserveAspectRatio="none" className="h-1.5 w-full max-w-40">
      <rect width="100" height="6" rx="3" className="fill-muted" />
      {width > 0 ? <rect width={width} height="6" rx="3" className="fill-brand" /> : null}
    </svg>
  );
}

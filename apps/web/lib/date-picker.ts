// Calendar arithmetic of the date picker on plain year, month (1 to 12) and day numbers, so no time zone moves a date.
export type Day = { y: number; m: number; d: number };

export function parseIsoDate(value: string): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m) ? { y, m, d } : null;
}

export function isoDate({ y, m, d }: Day): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// The person's own today, not UTC's: a date picked "today" late in the evening is still that day.
export function todayIso(now = new Date()): string {
  return isoDate({ y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() });
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDays(day: Day, days: number): Day {
  const date = new Date(Date.UTC(day.y, day.m - 1, day.d + days));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

// A month later or earlier on the same day, or the month's last day when it is shorter (31 January + 1 = 28 February).
export function addMonths(day: Day, months: number): Day {
  const index = day.y * 12 + (day.m - 1) + months;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return { y, m, d: Math.min(day.d, daysInMonth(y, m)) };
}

// The weeks of a month from Monday, with null for the days of the months around it.
export function monthGrid(y: number, m: number): (Day | null)[][] {
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const cells: (Day | null)[] = [...Array<null>(lead).fill(null)];
  for (let d = 1; d <= daysInMonth(y, m); d++) cells.push({ y, m, d });
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

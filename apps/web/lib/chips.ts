export type Noun = { one: string; other: string };

// "2 of 3 countries" when the plan limits the list, "2 countries" otherwise.
export function chosenCount(count: number, limit: number | null, noun: Noun): string {
  const word = (limit ?? count) === 1 ? noun.one : noun.other;
  return limit === null ? `${count} ${word}` : `${count} of ${limit} ${word}`;
}

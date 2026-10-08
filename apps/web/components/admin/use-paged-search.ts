"use client";

import { useRef, useState } from "react";
import type { Page } from "@/lib/dal/admin";

export type SearchAnswer<Row, Cursor> = { ok: true; page: Page<Row, Cursor> } | { ok: false };

type Status = "idle" | "loading" | "error" | "ready";

type State<Row, Cursor> = { status: Status; rows: Row[]; next: Cursor | null };

// Runs a search in pages of keyset cursors: the cursor each page started after is kept, so Previous returns to the
// page before without asking the database for a position. Rows of an earlier answer are never shown while a new one
// loads or after it failed, and an answer that arrives after a newer request was made is dropped.
export function usePagedSearch<Query, Row, Cursor>(
  fetchPage: (query: Query, after: Cursor | null) => Promise<SearchAnswer<Row, Cursor>>,
) {
  const [query, setQuery] = useState<Query | null>(null);
  const [cursors, setCursors] = useState<(Cursor | null)[]>([null]);
  const [index, setIndex] = useState(0);
  const [state, setState] = useState<State<Row, Cursor>>({ status: "idle", rows: [], next: null });
  const latest = useRef(0);

  async function run(nextQuery: Query, nextCursors: (Cursor | null)[], nextIndex: number) {
    const request = ++latest.current;
    setQuery(nextQuery);
    setCursors(nextCursors);
    setIndex(nextIndex);
    setState({ status: "loading", rows: [], next: null });
    let answer: SearchAnswer<Row, Cursor> = { ok: false };
    try {
      answer = await fetchPage(nextQuery, nextCursors[nextIndex]);
    } catch {
      answer = { ok: false };
    }
    if (request !== latest.current) return;
    setState(answer.ok ? { status: "ready", rows: answer.page.rows, next: answer.page.next } : { status: "error", rows: [], next: null });
  }

  return {
    state,
    page: index + 1,
    search: (nextQuery: Query) => run(nextQuery, [null], 0),
    next: () => query !== null && run(query, [...cursors.slice(0, index + 1), state.next], index + 1),
    previous: () => query !== null && index > 0 && run(query, cursors, index - 1),
    retry: () => query !== null && run(query, cursors, index),
  };
}

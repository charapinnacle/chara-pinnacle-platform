"use client";

import { useRef, useState } from "react";
import { networkStatisticsAction, type NetworkStatisticsAnswer } from "@/lib/actions/admin-statistics";
import type { NetworkStatistics } from "@/lib/admin/network-statistics";
import type { NetworkStatisticsQuery } from "@/lib/validation/admin";

type State = { status: "loading" | "error" | "ready"; query: NetworkStatisticsQuery; statistics: NetworkStatistics | null };

// Holds the answer of the partner network section: the figures of an earlier range are never shown while a new one loads
// or after it failed, and an answer that arrives after a newer request was made is dropped.
export function useNetworkStatistics(defaults: NetworkStatisticsQuery, initial: NetworkStatisticsAnswer) {
  const [state, setState] = useState<State>(
    initial.ok ? { status: "ready", query: defaults, statistics: initial.statistics } : { status: "error", query: defaults, statistics: null },
  );
  const latest = useRef(0);

  async function load(query: NetworkStatisticsQuery) {
    const request = ++latest.current;
    setState({ status: "loading", query, statistics: null });
    let answer: NetworkStatisticsAnswer = { ok: false };
    try {
      answer = await networkStatisticsAction(query);
    } catch {
      answer = { ok: false };
    }
    if (request !== latest.current) return;
    setState(answer.ok ? { status: "ready", query, statistics: answer.statistics } : { status: "error", query, statistics: null });
  }

  return { state, load };
}

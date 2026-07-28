"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export type RangeKey = "24h" | "7d" | "30d" | "90d" | "all";

export type MetricName =
  | "dividends_apr"
  | "staking_apr"
  | "lp_staking_apr"
  | "circulating_supply"
  | "runway_months"
  | "total_staked_slvr"
  | "lottery_round_state"
  | "emission_rate_30d";

export interface HistoryRow {
  t: string;
  v: number | null;
  v2: number | null;
  v3: number | null;
  block: number | null;
}

export interface HistoryResponse {
  metric: string;
  range: string;
  rows: HistoryRow[];
}

export interface UseHistoryResult {
  data: HistoryResponse | undefined;
  isLoading: boolean;
  error: unknown;
}

export function useHistory(
  metric: MetricName,
  range: RangeKey
): UseHistoryResult {
  const key = `/api/history?metric=${metric}&range=${range}`;
  const { data, isLoading, error } = useSWR<HistoryResponse>(key, fetcher, {
    keepPreviousData: true,
  });

  return { data, isLoading, error };
}

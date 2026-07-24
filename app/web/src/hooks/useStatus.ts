"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface StatusData {
  indexed_block: number;
  chain_head: number;
  lag_blocks: number;
  lag_seconds: number;
  checked_at: string;
}

export function useStatus() {
  const { data, isLoading, error } = useSWR<StatusData>(
    "/api/status",
    fetcher,
    { refreshInterval: 5_000 }
  );

  return { data: data ?? null, isLoading, error };
}

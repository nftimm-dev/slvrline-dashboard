"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export interface VitalsData {
  dividends_apr: {
    value: number;
    unit: string;
    snapshot_at: string;
    block_number: number | null;
    metadata?: Record<string, unknown> | null;
  } | null;
  circulating_supply: {
    value: number;
    value2: number | null;
    value3: number | null;
    snapshot_at: string;
    block_number: number | null;
  } | null;
  runway_months: {
    value: number;
    value2: number | null;
    snapshot_at: string;
    block_number: number | null;
  } | null;
  total_staked_slvr: {
    value: number;
    value2: number | null;
    value3: number | null;
    snapshot_at: string;
    block_number: number | null;
  } | null;
  lottery_round_state: {
    value: number;
    value2: number | null;
    snapshot_at: string;
    block_number: number | null;
  } | null;
  price: {
    slvr_usd: number;
    slvr_eth: number | null;
    eth_usd: number | null;
    cached_at: string;
  } | null;
}

export function useVitals() {
  const {
    data: vitalsRaw,
    isLoading: vitalsLoading,
    error: vitalsError,
  } = useSWR<VitalsData>("/api/vitals", fetcher, { refreshInterval: 10_000 });

  const isLoading = vitalsLoading;
  const error = vitalsError;

  return {
    data: vitalsRaw ?? null,
    isLoading,
    error,
  };
}

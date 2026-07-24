-- Phase 3: metric_snapshots table
-- Schema: metrics (separate from slvr which Ponder owns — Ponder rebuilds slvr on re-index)
-- Owned by: app/metrics/ cron job
-- Run once: psql -p 5433 slvrline -f db/migrations/003_metric_snapshots.sql

CREATE SCHEMA IF NOT EXISTS metrics;

CREATE TABLE IF NOT EXISTS metrics.metric_snapshots (
  id              BIGSERIAL PRIMARY KEY,
  metric_name     TEXT        NOT NULL,
  value           NUMERIC,                -- primary scalar (NULL if insufficient data)
  value2          NUMERIC,                -- secondary scalar (optional, metric-specific)
  value3          NUMERIC,                -- tertiary scalar (optional, metric-specific)
  metadata        JSONB,                  -- all intermediate values + inputs (required for audit)
  snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  block_number    BIGINT      NOT NULL    -- indexer's latest indexed block at time of computation
);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_name_time
  ON metrics.metric_snapshots (metric_name, snapshot_at DESC);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_block
  ON metrics.metric_snapshots (block_number DESC);

COMMENT ON TABLE metrics.metric_snapshots IS
  'Append-only time-series of computed protocol metrics. Written by app/metrics/ cron job. '
  'Read by API layer (Phase 4). Raw bigint values stored as NUMERIC; SLVR amounts stored as '
  'human units (divided by 1e18) in value/value2/value3. Full inputs stored in metadata JSONB. '
  'Schema is metrics (not slvr) so Ponder re-index does not drop this table.';

COMMENT ON COLUMN metrics.metric_snapshots.value IS
  'Primary scalar. SLVR amounts: human units (/1e18). APR: percentage (e.g. 1229.4 = 1229.4%). '
  'Round state: round_id integer. NULL = insufficient data (see metadata.data_status).';

COMMENT ON COLUMN metrics.metric_snapshots.metadata IS
  'JSON audit trail: raw bigint values as strings, inputs, formula version, data_status.';

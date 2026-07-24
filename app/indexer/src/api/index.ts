import { Hono } from "hono";

/**
 * Minimal API stub for bootstrap — proof-of-life only.
 * Ponder auto-provides /sql (SQL-over-HTTP) and /graphql endpoints.
 * Phase 1 will add custom metric endpoints here.
 */
const app = new Hono();

export default app;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS addresses (
  address TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'leaderboard',
  display_name TEXT,
  tags TEXT,
  excluded INTEGER NOT NULL DEFAULT 0,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_addresses_source ON addresses(source, excluded);
CREATE INDEX IF NOT EXISTS idx_addresses_last_seen ON addresses(last_seen);

CREATE TABLE IF NOT EXISTS leaderboard (
  address TEXT PRIMARY KEY,
  as_of INTEGER NOT NULL,
  account_value REAL NOT NULL DEFAULT 0,
  day_pnl REAL, day_roi REAL, day_vlm REAL,
  week_pnl REAL, week_roi REAL, week_vlm REAL,
  month_pnl REAL, month_roi REAL, month_vlm REAL,
  all_pnl REAL, all_roi REAL, all_vlm REAL
);
CREATE INDEX IF NOT EXISTS idx_lb_month_roi ON leaderboard(month_roi DESC);
CREATE INDEX IF NOT EXISTS idx_lb_month_vlm ON leaderboard(month_vlm DESC);
CREATE INDEX IF NOT EXISTS idx_lb_week_roi ON leaderboard(week_roi DESC);
CREATE INDEX IF NOT EXISTS idx_lb_day_roi ON leaderboard(day_roi DESC);
CREATE INDEX IF NOT EXISTS idx_lb_all_roi ON leaderboard(all_roi DESC);
CREATE INDEX IF NOT EXISTS idx_lb_account_value ON leaderboard(account_value DESC);
CREATE INDEX IF NOT EXISTS idx_lb_as_of ON leaderboard(as_of);

CREATE TABLE IF NOT EXISTS metric_cache (
  address TEXT NOT NULL,
  period TEXT NOT NULL,
  as_of INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  data_ts INTEGER NOT NULL,
  PRIMARY KEY (address, period)
);

CREATE TABLE IF NOT EXISTS fills (
  address TEXT NOT NULL,
  tid INTEGER NOT NULL,
  time INTEGER NOT NULL,
  coin TEXT NOT NULL,
  px REAL NOT NULL,
  sz REAL NOT NULL,
  side TEXT NOT NULL,
  start_position REAL NOT NULL,
  closed_pnl REAL NOT NULL DEFAULT 0,
  fee REAL NOT NULL DEFAULT 0,
  dir TEXT,
  hash TEXT,
  PRIMARY KEY (address, tid)
);
CREATE INDEX IF NOT EXISTS idx_fills_addr_coin_time ON fills(address, coin, time);
CREATE INDEX IF NOT EXISTS idx_fills_addr_time ON fills(address, time);

CREATE TABLE IF NOT EXISTS position_episodes (
  address TEXT NOT NULL,
  period TEXT NOT NULL,
  as_of INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  data_ts INTEGER NOT NULL,
  truncated INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (address, period)
);

CREATE TABLE IF NOT EXISTS position_holding (
  address TEXT NOT NULL,
  coin TEXT NOT NULL,
  entry_time INTEGER,
  covered_from INTEGER,
  truncated INTEGER NOT NULL DEFAULT 0,
  data_ts INTEGER NOT NULL,
  PRIMARY KEY (address, coin)
);

CREATE TABLE IF NOT EXISTS position_snapshots (
  address TEXT NOT NULL,
  ts INTEGER NOT NULL,
  account_value REAL NOT NULL,
  gross_notional REAL NOT NULL,
  net_notional REAL NOT NULL,
  gross_leverage REAL NOT NULL,
  positions_json TEXT NOT NULL,
  PRIMARY KEY (address, ts)
);
CREATE INDEX IF NOT EXISTS idx_snapshots_addr_ts ON position_snapshots(address, ts);

CREATE TABLE IF NOT EXISTS watchlist (
  address TEXT PRIMARY KEY,
  note TEXT,
  added_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT,
  meta_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sync_runs_job ON sync_runs(job, started_at DESC);
`;

-- Ported from hub/db.py's SCHEMA string, as close to verbatim as SQLite dialect allows.
-- IF NOT EXISTS everywhere so this is idempotent, same migration strategy as the Python
-- original (no migration-history table there either — ALTER TABLE additions are gated by
-- checking column existence first; port that same gating in lib/db-init.ts, not here).

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  color TEXT DEFAULT '#5a4fcf',
  logo_url TEXT DEFAULT '',
  sitemap TEXT DEFAULT '',
  max_pages INTEGER DEFAULT 120,
  gsc_property TEXT DEFAULT '',
  competitors TEXT DEFAULT '[]',
  keywords TEXT DEFAULT '[]',
  settings TEXT DEFAULT '{}',
  created_at REAL
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT, kind TEXT,
  started_at REAL, finished_at REAL,
  status TEXT,
  score INTEGER,
  summary TEXT DEFAULT '{}',
  error TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS runs_p ON runs(project_id, kind, started_at);

CREATE TABLE IF NOT EXISTS pages (
  run_id INTEGER, url TEXT, kind TEXT,
  status INTEGER, ms INTEGER, kb INTEGER,
  title TEXT, title_len INTEGER, desc_len INTEGER,
  canonical TEXT, h1_count INTEGER, words INTEGER,
  imgs INTEGER, imgs_no_alt INTEGER,
  jsonld TEXT,
  og_image INTEGER, noindex INTEGER,
  inlinks INTEGER, outlinks INTEGER, issues INTEGER
);
CREATE INDEX IF NOT EXISTS pages_r ON pages(run_id);

CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT, code TEXT,
  url TEXT, severity TEXT,
  detail TEXT,
  status TEXT DEFAULT 'open',
  first_seen REAL, last_seen REAL, fixed_at REAL,
  UNIQUE(project_id, code, url)
);

CREATE TABLE IF NOT EXISTS uptime (project_id TEXT, ts REAL, status INTEGER, ms INTEGER);
CREATE INDEX IF NOT EXISTS uptime_p ON uptime(project_id, ts);

CREATE TABLE IF NOT EXISTS gsc_daily (
  project_id TEXT, date TEXT, clicks REAL, impressions REAL, ctr REAL, position REAL,
  PRIMARY KEY(project_id, date)
);

CREATE TABLE IF NOT EXISTS gsc_snap (
  project_id TEXT, snap TEXT,
  dim TEXT,
  key TEXT,
  clicks REAL, impressions REAL, ctr REAL, position REAL,
  prev_clicks REAL, prev_position REAL,
  PRIMARY KEY(project_id, snap, dim, key)
);

CREATE TABLE IF NOT EXISTS compares (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, ts REAL, data TEXT);

CREATE TABLE IF NOT EXISTS images (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, ts REAL, file TEXT, spec TEXT);

CREATE TABLE IF NOT EXISTS catalog (
  project_id TEXT, url TEXT, kind TEXT,
  data TEXT,
  last_seen REAL,
  PRIMARY KEY(project_id, url)
);

CREATE TABLE IF NOT EXISTS fixes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT, url TEXT,
  type TEXT,
  severity TEXT, current TEXT, proposed TEXT, detail TEXT,
  status TEXT DEFAULT 'pending',
  created REAL, updated REAL,
  apply_error TEXT DEFAULT '',
  base_hash TEXT DEFAULT '',
  UNIQUE(project_id, url, type)
);

CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT, kind TEXT,
  status TEXT,
  topic TEXT, brief TEXT, output TEXT, flags TEXT, note TEXT,
  created REAL, updated REAL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  is_admin INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
  created_at REAL, last_login REAL,
  telegram_chat TEXT DEFAULT '',
  totp_secret TEXT DEFAULT '',
  totp_pending TEXT DEFAULT '',
  recovery TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS members (user_id INTEGER, project_id TEXT, role TEXT, PRIMARY KEY(user_id, project_id));

CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER, expires REAL);

CREATE TABLE IF NOT EXISTS applied (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT, fix_id INTEGER, url TEXT, type TEXT,
  before TEXT, after TEXT,
  ts REAL, user_name TEXT, undone INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vitals (
  project_id TEXT, url TEXT, strategy TEXT,
  ts REAL, score INTEGER, lcp REAL, cls REAL, tbt REAL,
  field_inp REAL, field_lcp REAL, field_overall TEXT
);
CREATE INDEX IF NOT EXISTS vitals_p ON vitals(project_id, ts);

CREATE TABLE IF NOT EXISTS index_status (
  project_id TEXT, url TEXT, verdict TEXT,
  coverage TEXT, last_crawl TEXT, canonical TEXT, ts REAL,
  PRIMARY KEY(project_id, url)
);

CREATE TABLE IF NOT EXISTS keywords (
  project_id TEXT, keyword TEXT,
  action TEXT,
  topic TEXT, target_url TEXT,
  status TEXT,
  reason TEXT, example TEXT, competitors INTEGER,
  position REAL, impressions REAL DEFAULT 0, clicks REAL DEFAULT 0,
  first_position REAL, idea_id INTEGER, task_id INTEGER,
  created REAL, updated REAL,
  PRIMARY KEY(project_id, keyword)
);

CREATE TABLE IF NOT EXISTS experiments (
  applied_id INTEGER, project_id TEXT, url TEXT, days INTEGER,
  views_before REAL, carts_before REAL, units_before REAL,
  views_after REAL, carts_after REAL, units_after REAL,
  verdict TEXT,
  measured REAL,
  PRIMARY KEY(applied_id, days)
);

CREATE TABLE IF NOT EXISTS rollbacks (applied_id INTEGER PRIMARY KEY, project_id TEXT, url TEXT, reason TEXT, action TEXT, ts REAL);

CREATE TABLE IF NOT EXISTS price_links (project_id TEXT, url TEXT, torob_url TEXT, added REAL, PRIMARY KEY(project_id, url));

CREATE TABLE IF NOT EXISTS price_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, url TEXT, checked REAL,
  own INTEGER, low INTEGER, high INTEGER, offers INTEGER, error TEXT
);

CREATE TABLE IF NOT EXISTS serp (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, keyword TEXT, checked REAL,
  own_rank INTEGER, own_url TEXT, results TEXT
);

CREATE TABLE IF NOT EXISTS backlinks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, url TEXT, site TEXT,
  kind TEXT,
  why TEXT, pitch TEXT,
  status TEXT DEFAULT 'open',
  checked REAL, created REAL,
  sent_at REAL,
  UNIQUE(project_id, site)
);

CREATE TABLE IF NOT EXISTS impact (
  applied_id INTEGER, project_id TEXT, url TEXT, type TEXT, days INTEGER,
  clicks_before REAL, impressions_before REAL, position_before REAL,
  clicks_after REAL, impressions_after REAL, position_after REAL,
  verdict TEXT, measured REAL,
  PRIMARY KEY(applied_id, days)
);

CREATE TABLE IF NOT EXISTS comp_seen (project_id TEXT, domain TEXT, url TEXT, title TEXT DEFAULT '', first_seen REAL, PRIMARY KEY(project_id, url));

CREATE TABLE IF NOT EXISTS comp_pages (project_id TEXT, domain TEXT, url TEXT, title TEXT, h1 TEXT, h2 TEXT, ts REAL, PRIMARY KEY(project_id, url));

CREATE TABLE IF NOT EXISTS watches (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, mine TEXT, others TEXT, last TEXT, changes TEXT, ts REAL);

CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, ts REAL, data TEXT, prev TEXT);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, title TEXT, ref TEXT DEFAULT '',
  assignee_id INTEGER, due TEXT DEFAULT '', status TEXT DEFAULT 'todo',
  created_by TEXT, created REAL, updated REAL
);

CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER, user_name TEXT, body TEXT, ts REAL);

CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, user_name TEXT, action TEXT, ts REAL);
CREATE INDEX IF NOT EXISTS activity_p ON activity(project_id, id);

CREATE TABLE IF NOT EXISTS agent_tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, token_hash TEXT, created REAL, last_seen REAL);

CREATE TABLE IF NOT EXISTS writer_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, what TEXT, limit_n INTEGER, status TEXT, ts REAL);

CREATE TABLE IF NOT EXISTS site_articles (
  project_id TEXT, slug TEXT, title TEXT, published INTEGER, meta TEXT,
  views INTEGER, created TEXT, author TEXT, tags TEXT, synced REAL,
  PRIMARY KEY(project_id, slug)
);

CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT, topic TEXT, keyword TEXT, topic_key TEXT,
  source TEXT, score REAL, status TEXT, reason TEXT, ts REAL,
  meta TEXT DEFAULT '{}',
  UNIQUE(project_id, topic_key)
);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

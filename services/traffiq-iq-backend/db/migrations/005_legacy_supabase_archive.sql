CREATE TABLE IF NOT EXISTS legacy_supabase_rows (
  source_table text NOT NULL,
  source_id text NOT NULL,
  payload jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, source_id)
);
CREATE INDEX IF NOT EXISTS legacy_supabase_rows_table_idx
  ON legacy_supabase_rows(source_table);

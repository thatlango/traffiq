CREATE TABLE IF NOT EXISTS legacy_supabase_rows (
  source_table text NOT NULL,
  source_key text NOT NULL,
  row_data jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, source_key)
);

CREATE INDEX IF NOT EXISTS legacy_supabase_rows_imported_idx
  ON legacy_supabase_rows(imported_at DESC);

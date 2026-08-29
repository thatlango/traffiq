INSERT INTO users(id,email,display_name,password_hash,status)
VALUES
  ('2ba4899c-42c2-4639-a533-399653e383d1','legacy-2ba4899c@invalid.traffiq','Legacy TraffIQ user','disabled-legacy','disabled'),
  ('6fa2d940-e429-4e63-ad64-ab16cafff7a2','legacy-6fa2d940@invalid.traffiq','Legacy TraffIQ user','disabled-legacy','disabled')
ON CONFLICT(id) DO NOTHING;

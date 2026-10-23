-- Online leaderboard: one row per finished run.
-- The game is a static site, so anyone with the public (anon) key can read
-- and insert. Checks below keep rows sane; they can't stop a hand-crafted score.
create table if not exists public.scores (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 16),
  cls text not null check (cls in ('warrior', 'ranger', 'mage')),
  wins int not null check (wins between 0 and 500),
  killed_by text not null default '' check (char_length(killed_by) <= 40),
  skills jsonb not null default '[]'::jsonb check (jsonb_typeof(skills) = 'array'),
  created_at timestamptz not null default now()
);

create index if not exists scores_rank_idx on public.scores (cls, wins desc, created_at);
create index if not exists scores_rank_all_idx on public.scores (wins desc, created_at);

alter table public.scores enable row level security;

drop policy if exists "scores are public" on public.scores;
create policy "scores are public" on public.scores
  for select to anon, authenticated using (true);

-- Insert only; no updates or deletes from the client.
drop policy if exists "anyone can submit a run" on public.scores;
create policy "anyone can submit a run" on public.scores
  for insert to anon, authenticated with check (created_at > now() - interval '1 minute');

grant select, insert on public.scores to anon, authenticated;

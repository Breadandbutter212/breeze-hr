-- Per-company Merge (HRIS/Payroll) connection tokens.
-- Run once in Supabase → SQL Editor. The /api/merge-search endpoint writes/reads
-- this with the service key (RLS is bypassed server-side), so no client policies are needed.

create table if not exists public.merge_connections (
  company_id   uuid primary key references public.companies(id) on delete cascade,
  account_token text not null,
  integration  text,
  connected_at timestamptz not null default now()
);

-- Lock the table down: only the service role (our serverless functions) may touch it.
alter table public.merge_connections enable row level security;
-- (No policies = no anon/authenticated access. Service key bypasses RLS.)

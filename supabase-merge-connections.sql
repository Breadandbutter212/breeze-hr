-- Merge (HRIS/Payroll) integration: per-company tokens + a role gate.
-- Run this ONCE in Supabase → SQL Editor. The /api/merge-search endpoint reads/writes
-- these with the service key (RLS bypassed server-side), so no client policies are needed.

-- 1. Per-company Merge connection tokens.
create table if not exists public.merge_connections (
  company_id   uuid primary key references public.companies(id) on delete cascade,
  account_token text not null,
  integration  text,
  connected_at timestamptz not null default now()
);

alter table public.merge_connections enable row level security;
-- (No policies = no anon/authenticated access. Service key bypasses RLS.)

-- 2. Role on profiles so only owners/admins can read HRIS PII or change the connection.
--    Every existing user is the sole member of their own company, so backfill them to 'owner'.
alter table public.profiles add column if not exists role text not null default 'owner';
update public.profiles set role = 'owner' where role is null;

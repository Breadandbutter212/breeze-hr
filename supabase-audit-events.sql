-- Security audit log. Append-only record of security-relevant events
-- (logins, logouts, document/export downloads, email sends, HRIS connect/
-- disconnect, settings changes). Written ONLY via /api/audit with the service
-- key, so the client can never forge company_id or backdate an event.
-- Run this ONCE in Supabase -> SQL Editor.

create table if not exists public.audit_events (
  id          bigint generated always as identity primary key,
  company_id  uuid references public.companies(id) on delete cascade,
  user_id     uuid,
  user_email  text,
  action      text not null,          -- e.g. 'login', 'email.send', 'document.generate'
  detail      jsonb,                  -- small structured context (no message bodies / PII payloads)
  ip          text,
  created_at  timestamptz not null default now()
);

-- RLS on with NO policies: no anon/authenticated access at all. All writes and
-- admin reads go through /api/audit using the service key (which bypasses RLS).
alter table public.audit_events enable row level security;

create index if not exists audit_events_company_created_idx
  on public.audit_events (company_id, created_at desc);

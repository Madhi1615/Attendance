-- KORA schema
-- Run this once in Supabase SQL Editor (Project → SQL Editor → New query → paste → Run).
-- Safe to run more than once — every statement is idempotent, so re-running this file to pick
-- up a later change won't error on objects that already exist.

-- =========================================================================
-- Tenancy
-- =========================================================================

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  whatsapp_dispatcher_phone text, -- E.164, e.g. +4915112345678. Where the AI assistant sends proactive messages.
  vat_percent numeric not null default 19,
  created_at timestamptz not null default now()
);

-- Links a Supabase Auth user to a company, so a dispatcher can only ever see their own company's data.
create table if not exists company_members (
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'dispatcher' check (role in ('owner', 'dispatcher')),
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create or replace function current_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from company_members where user_id = auth.uid();
$$;

-- =========================================================================
-- People & credentials
-- =========================================================================

create table if not exists guards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  phone text, -- E.164, used for WhatsApp deep links and outbound notifications.
  email text,
  portal_token uuid not null default gen_random_uuid(), -- opaque, unguessable — the employee's personal web link.
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists guards_company_idx on guards(company_id);
create unique index if not exists guards_portal_token_idx on guards(portal_token);

-- Not verified against the federal Bewacherregister in real time — no public API exists for that (§7 BewachRV).
-- These rows record what the register's own portal confirmed to the employer, so KORA can hard-block scheduling.
create table if not exists credentials (
  id uuid primary key default gen_random_uuid(),
  guard_id uuid not null references guards(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  qualification text not null check (qualification in ('unterrichtung', 'sachkunde', 'meister')),
  bewacher_id text, -- register identification number, stored for reference only, never surfaced in WhatsApp text
  permitted_deployment text, -- zulässige Einsatzmöglichkeiten, as returned with the Anmeldebestätigung
  registered_at date,
  expires_at date not null,
  created_at timestamptz not null default now()
);
create index if not exists credentials_guard_idx on credentials(guard_id);
create index if not exists credentials_company_idx on credentials(company_id);
create index if not exists credentials_expiry_idx on credentials(expires_at);

-- =========================================================================
-- Clients, requests, quotes
-- =========================================================================

create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  contact_email text,
  contact_phone text,
  created_at timestamptz not null default now()
);
create index if not exists clients_company_idx on clients(company_id);

create table if not exists requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  client_id uuid references clients(id) on delete set null,
  title text not null,
  location text,
  federal_state text not null default 'Berlin', -- determines which rate_cards row applies
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  guards_required int not null default 1,
  qualification_required text not null default 'unterrichtung' check (qualification_required in ('unterrichtung', 'sachkunde', 'meister')),
  status text not null default 'new' check (status in ('new', 'quoted', 'planned', 'executed', 'invoiced', 'cancelled')),
  created_at timestamptz not null default now()
);
create index if not exists requests_company_idx on requests(company_id);

create table if not exists quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references requests(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  hourly_cost numeric not null,
  premiums_cost numeric not null default 0,
  margin_percent numeric not null default 20,
  subtotal numeric not null,
  total numeric not null,
  breakdown jsonb not null default '{}'::jsonb, -- itemised per-guard/per-hour lines shown on the PDF
  created_at timestamptz not null default now()
);
create index if not exists quotes_request_idx on quotes(request_id);

-- =========================================================================
-- Shifts & assignments
-- =========================================================================

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  request_id uuid not null references requests(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  qualification_required text not null default 'unterrichtung' check (qualification_required in ('unterrichtung', 'sachkunde', 'meister')),
  created_at timestamptz not null default now()
);
create index if not exists shifts_company_idx on shifts(company_id);
create index if not exists shifts_request_idx on shifts(request_id);

create table if not exists shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shifts(id) on delete cascade,
  guard_id uuid not null references guards(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'declined', 'confirmed')),
  hours_worked numeric, -- filled in after execution, drives invoicing
  created_at timestamptz not null default now(),
  unique (shift_id, guard_id)
);
create index if not exists shift_assignments_shift_idx on shift_assignments(shift_id);
create index if not exists shift_assignments_guard_idx on shift_assignments(guard_id);

-- Hard block at the database level: no valid credential, no spot in the plan.
-- This runs even if the frontend check is bypassed, so the rule can never be worked around.
create or replace function enforce_credential_and_availability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_shift shifts%rowtype;
  v_has_valid_credential boolean;
  v_double_booked boolean;
begin
  select * into v_shift from shifts where id = new.shift_id;

  select exists (
    select 1 from credentials c
    where c.guard_id = new.guard_id
      and c.expires_at >= v_shift.starts_at::date
      and (
        (v_shift.qualification_required = 'unterrichtung') or
        (v_shift.qualification_required = 'sachkunde' and c.qualification in ('sachkunde', 'meister')) or
        (v_shift.qualification_required = 'meister' and c.qualification = 'meister')
      )
  ) into v_has_valid_credential;

  if not v_has_valid_credential then
    raise exception 'No valid Bewacher-ID / credential for this guard covering %, no spot in the plan.', v_shift.qualification_required;
  end if;

  select exists (
    select 1 from shift_assignments sa
    join shifts s on s.id = sa.shift_id
    where sa.guard_id = new.guard_id
      and sa.id is distinct from new.id
      and sa.status <> 'declined'
      and s.starts_at < v_shift.ends_at
      and s.ends_at > v_shift.starts_at
  ) into v_double_booked;

  if v_double_booked then
    raise exception 'Guard is already booked on an overlapping shift.';
  end if;

  return new;
end;
$$;

create or replace trigger trg_enforce_credential_and_availability
before insert or update on shift_assignments
for each row execute function enforce_credential_and_availability();

-- =========================================================================
-- Rate cards (state + qualification specific tariff rates and premiums)
-- =========================================================================

create table if not exists rate_cards (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  federal_state text not null,
  qualification text not null check (qualification in ('unterrichtung', 'sachkunde', 'meister')),
  hourly_rate numeric not null,
  night_premium_percent numeric not null default 25,
  sunday_premium_percent numeric not null default 50,
  holiday_premium_percent numeric not null default 100,
  created_at timestamptz not null default now(),
  unique (company_id, federal_state, qualification)
);

-- =========================================================================
-- Invoices & audit records
-- =========================================================================

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  request_id uuid not null references requests(id) on delete cascade,
  invoice_number text not null,
  line_items jsonb not null default '[]'::jsonb,
  subtotal numeric not null,
  vat_percent numeric not null default 19,
  vat_amount numeric not null,
  total numeric not null,
  audit_record jsonb not null default '{}'::jsonb, -- Prüfprotokoll: who worked, which credential, valid at the time
  created_at timestamptz not null default now(),
  unique (company_id, invoice_number)
);
create index if not exists invoices_company_idx on invoices(company_id);

-- =========================================================================
-- WhatsApp message log (for the AI assistant + audit trail — never stores documents, only text/links)
-- =========================================================================

create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  guard_id uuid references guards(id) on delete set null,
  to_phone text,
  from_phone text,
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  wa_message_id text,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_messages_company_idx on whatsapp_messages(company_id);

-- =========================================================================
-- Row Level Security
-- =========================================================================

alter table companies enable row level security;
alter table company_members enable row level security;
alter table guards enable row level security;
alter table credentials enable row level security;
alter table clients enable row level security;
alter table requests enable row level security;
alter table quotes enable row level security;
alter table shifts enable row level security;
alter table shift_assignments enable row level security;
alter table rate_cards enable row level security;
alter table invoices enable row level security;
alter table whatsapp_messages enable row level security;

drop policy if exists "members can read own company" on companies;
create policy "members can read own company" on companies
  for select using (id in (select current_company_ids()));

drop policy if exists "members can read own membership rows" on company_members;
create policy "members can read own membership rows" on company_members
  for select using (user_id = auth.uid());

drop policy if exists "members can manage own company guards" on guards;
create policy "members can manage own company guards" on guards
  for all using (company_id in (select current_company_ids()))
  with check (company_id in (select current_company_ids()));

drop policy if exists "members can manage own company credentials" on credentials;
create policy "members can manage own company credentials" on credentials
  for all using (company_id in (select current_company_ids()))
  with check (company_id in (select current_company_ids()));

drop policy if exists "members can manage own company clients" on clients;
create policy "members can manage own company clients" on clients
  for all using (company_id in (select current_company_ids()))
  with check (company_id in (select current_company_ids()));

drop policy if exists "members can manage own company requests" on requests;
create policy "members can manage own company requests" on requests
  for all using (company_id in (select current_company_ids()))
  with check (company_id in (select current_company_ids()));

drop policy if exists "members can manage own company quotes" on quotes;
create policy "members can manage own company quotes" on quotes
  for all using (company_id in (select current_company_ids()))
  with check (company_id in (select current_company_ids()));

drop policy if exists "members can manage own company shifts" on shifts;
create policy "members can manage own company shifts" on shifts
  for all using (company_id in (select current_company_ids()))
  with check (company_id in (select current_company_ids()));

drop policy if exists "members can manage own company shift_assignments" on shift_assignments;
create policy "members can manage own company shift_assignments" on shift_assignments
  for all using (company_id in (select current_company_ids()))
  with check (company_id in (select current_company_ids()));

drop policy if exists "members can manage own company rate_cards" on rate_cards;
create policy "members can manage own company rate_cards" on rate_cards
  for all using (company_id in (select current_company_ids()))
  with check (company_id in (select current_company_ids()));

drop policy if exists "members can manage own company invoices" on invoices;
create policy "members can manage own company invoices" on invoices
  for all using (company_id in (select current_company_ids()))
  with check (company_id in (select current_company_ids()));

drop policy if exists "members can read own company whatsapp_messages" on whatsapp_messages;
create policy "members can read own company whatsapp_messages" on whatsapp_messages
  for select using (company_id in (select current_company_ids()));

-- No policies grant anon/authenticated access beyond the above. The employee portal, the WhatsApp
-- webhook, and the AI assistant all run as Edge Functions using the service role key, which bypasses
-- RLS intentionally and applies its own narrow, hand-checked filters (see supabase/functions/).

-- =========================================================================
-- GDPR data export / anonymisation helper (Betriebsrat / § 87 BetrVG readiness)
-- =========================================================================

-- Deletes a guard's personal data while preserving the shift/invoice history needed for
-- financial and audit records, by nulling identifying fields instead of deleting the rows.
create or replace function anonymise_guard(p_guard_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update guards
    set name = 'Removed guard', phone = null, email = null
    where id = p_guard_id;
  delete from credentials where guard_id = p_guard_id;
end;
$$;

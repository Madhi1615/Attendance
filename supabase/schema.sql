-- ClassTap Attendance
-- Run this entire file once in Supabase > SQL Editor.
-- Scope intentionally excludes authentication, so anon/public CRUD policies are enabled.

create extension if not exists pgcrypto;

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  year smallint not null check (year between 1 and 4),
  department text not null check (department in ('CSE', 'ECE', 'IT')),
  label text not null check (char_length(trim(label)) > 0),
  timing text not null check (char_length(trim(timing)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(),
  unique (id, schedule_id)
);

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  student_id uuid not null,
  attendance_date date not null,
  present boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_student_belongs_to_schedule
    foreign key (student_id, schedule_id)
    references public.students(id, schedule_id)
    on delete cascade,
  constraint one_attendance_record_per_student_per_day
    unique (schedule_id, student_id, attendance_date)
);

create index if not exists idx_students_schedule
  on public.students(schedule_id, display_order);

create index if not exists idx_attendance_schedule_date
  on public.attendance_records(schedule_id, attendance_date);

create index if not exists idx_attendance_student
  on public.attendance_records(student_id);

-- Supabase Data API permissions.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.schedules to anon, authenticated;
grant select, insert, update, delete on public.students to anon, authenticated;
grant select, insert, update, delete on public.attendance_records to anon, authenticated;

-- RLS is enabled because Supabase exposes these tables through its browser-facing API.
alter table public.schedules enable row level security;
alter table public.students enable row level security;
alter table public.attendance_records enable row level security;

-- The product requirement explicitly says no authentication.
-- Therefore anyone who has the public app URL can access this data.
-- Replace these policies with user-scoped policies when authentication is added later.
drop policy if exists "public schedules access" on public.schedules;
create policy "public schedules access"
  on public.schedules
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "public students access" on public.students;
create policy "public students access"
  on public.students
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "public attendance access" on public.attendance_records;
create policy "public attendance access"
  on public.attendance_records
  for all
  to anon, authenticated
  using (true)
  with check (true);

-- Issue #53: public reports are distinct from satellite detections.
create table if not exists public.fire_reports (
 id bigint generated always as identity primary key,
 latitude double precision not null check (latitude between -90 and 90),
 longitude double precision not null check (longitude between -180 and 180),
 sighting text not null,
 description text not null default '',
 observed_at timestamptz not null,
 review_status text not null default 'unverified'
   check (review_status in ('unverified','confirmed','rejected','out_of_control','being_held','under_control','out')),
 created_at timestamptz not null default now()
);
create index if not exists fire_reports_status_time_idx on public.fire_reports (review_status, created_at desc);
create table if not exists public.fire_report_audit (
 id bigint generated always as identity primary key,
 report_id bigint not null references public.fire_reports(id) on delete cascade,
 old_status text not null,
 new_status text not null,
 staff_id text not null,
 changed_at timestamptz not null default now()
);
create index if not exists fire_report_audit_report_time_idx on public.fire_report_audit (report_id, changed_at desc);
alter table public.fire_reports enable row level security;
alter table public.fire_report_audit enable row level security;

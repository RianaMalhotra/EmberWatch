-- Issue #53: extend the existing #52 report schema; preserve provenance and duplicate links.
alter table public.fire_reports drop constraint if exists fire_reports_review_status_check;
alter table public.fire_reports add constraint fire_reports_review_status_check
  check (review_status in ('unverified','verified','confirmed','rejected',
    'out_of_control','being_held','under_control','out'));
create index if not exists fire_reports_status_time_idx
  on public.fire_reports (review_status, created_at desc);
create table if not exists public.fire_report_audit (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.fire_reports(id) on delete cascade,
  old_status text not null,
  new_status text not null,
  staff_id text not null,
  changed_at timestamptz not null default now()
);
create index if not exists fire_report_audit_report_time_idx
  on public.fire_report_audit (report_id, changed_at desc);
alter table public.fire_report_audit enable row level security;

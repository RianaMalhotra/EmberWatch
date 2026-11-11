-- Issue #52: public fire reports from the "Report a Fire" form (#51).
--
-- Every report starts as 'unverified' until staff review it (#53). Reports are
-- never sent to emergency services.
--
-- Provenance: source says where the report came from, location_source says
-- how the point was chosen (GPS or a pin on the map), observed_at is when the
-- person saw the fire and created_at is when the server stored it (both UTC).
--
-- Privacy: client_key is a salted SHA-256 hash of the sender's IP address,
-- used only for rate limiting. The raw IP address is never stored.

create table public.fire_reports (
    id                  bigint generated always as identity primary key,
    latitude            double precision not null check (latitude between -90 and 90),
    longitude           double precision not null check (longitude between -180 and 180),
    location            extensions.geography(point, 4326)
                        generated always as (
                            extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
                        ) stored,
    location_source     text not null check (location_source in ('gps', 'map')),
    observed_type       text not null check (observed_type in ('flames', 'smoke', 'both')),
    observed_at         timestamptz not null,
    description         text check (description is null or char_length(description) between 1 and 500),
    source              text not null default 'public_report',
    review_status       text not null default 'unverified'
                        check (review_status in ('unverified', 'verified', 'rejected')),
    client_key          text not null,
    -- Provisional duplicate linking: the closest earlier report / satellite
    -- detection within 2 km and 24 h. Linked reports are still stored, never
    -- dropped, so staff can see how many people reported the same fire.
    linked_report_id    bigint references public.fire_reports (id) on delete set null,
    linked_detection_id bigint references public.detections (id) on delete set null,
    created_at          timestamptz not null default now()
);

create index fire_reports_location_idx on public.fire_reports using gist (location);
create index fire_reports_observed_at_idx on public.fire_reports (observed_at desc);
create index fire_reports_client_recent_idx on public.fire_reports (client_key, created_at desc);

comment on table public.fire_reports is
    'Public fire reports (#52). Unverified until reviewed (#53); not an official alert.';
comment on column public.fire_reports.client_key is
    'Salted SHA-256 hash of the sender IP, for rate limiting only. Raw IPs are never stored.';

-- Same rule as the other tables: Flask connects directly to Postgres, so the
-- public Supabase REST API gets no access (RLS on, no policies).
alter table public.fire_reports enable row level security;

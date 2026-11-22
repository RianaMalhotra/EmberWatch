-- Isolated CI schema mirroring production detection columns and uniqueness.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
CREATE TABLE public.detections (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 latitude double precision NOT NULL CHECK(latitude BETWEEN -90 AND 90),
 longitude double precision NOT NULL CHECK(longitude BETWEEN -180 AND 180),
 location extensions.geography(point,4326) GENERATED ALWAYS AS (
   extensions.st_setsrid(extensions.st_makepoint(longitude,latitude),4326)::extensions.geography
 ) STORED,
 detected_at timestamptz NOT NULL,
 confidence real NOT NULL CHECK(confidence BETWEEN 0 AND 100),
 confidence_class text NOT NULL CHECK(confidence_class IN ('low','nominal','high')),
 instrument text, satellite text, frp real,
 daynight text CHECK(daynight IN ('D','N')),
 fire_type smallint CHECK(fire_type BETWEEN 0 AND 3),
 source text NOT NULL DEFAULT 'NASA FIRMS',
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT detections_unique UNIQUE NULLS NOT DISTINCT(latitude,longitude,detected_at,satellite)
);
CREATE INDEX detections_location_idx ON public.detections USING gist(location);

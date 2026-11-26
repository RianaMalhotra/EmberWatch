ALTER TABLE public.fire_reports
ADD COLUMN ended_at TIMESTAMPTZ;

CREATE INDEX fire_reports_ended_at_idx
ON public.fire_reports (ended_at)
WHERE ended_at IS NOT NULL;
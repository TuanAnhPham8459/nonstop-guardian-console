CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  session_id text NOT NULL,
  actor text NOT NULL CHECK (actor IN ('operator', 'assistant', 'system')),
  event_type text NOT NULL CHECK (event_type IN ('question', 'proposed', 'blocked', 'approved', 'rejected', 'output', 'interpretation', 'debrief', 'error', 'proactive')),
  question text,
  command text,
  risk text,
  output text,
  interpretation text,
  detail text
);
CREATE INDEX audit_log_created_at_idx ON public.audit_log (created_at DESC);

GRANT SELECT, INSERT ON public.audit_log TO anon, authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Prototype can read audit log" ON public.audit_log FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Prototype can append audit log" ON public.audit_log FOR INSERT TO anon, authenticated
  WITH CHECK (length(coalesce(question,'')) <= 2000 AND length(coalesce(output,'')) <= 10000 AND length(coalesce(interpretation,'')) <= 10000 AND length(coalesce(detail,'')) <= 4000 AND length(session_id) <= 100);
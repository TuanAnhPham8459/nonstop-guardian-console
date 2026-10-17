CREATE SEQUENCE public.knowledge_notes_seq START 1;

CREATE TABLE public.knowledge_notes (
  id text PRIMARY KEY DEFAULT ('KN-' || lpad(nextval('public.knowledge_notes_seq')::text, 3, '0')),
  title text NOT NULL,
  symptoms text NOT NULL DEFAULT '',
  cause text NOT NULL DEFAULT '',
  what_to_check_first text NOT NULL DEFAULT '',
  contributed_by text NOT NULL DEFAULT 'unknown',
  source_type text NOT NULL CHECK (source_type IN ('hpe-doc', 'past-incident', 'expert-note')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.knowledge_notes TO anon, authenticated;
GRANT ALL ON public.knowledge_notes TO service_role;
GRANT USAGE ON SEQUENCE public.knowledge_notes_seq TO anon, authenticated, service_role;

ALTER TABLE public.knowledge_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read notes" ON public.knowledge_notes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Debriefs can add expert notes" ON public.knowledge_notes FOR INSERT TO anon, authenticated
  WITH CHECK (source_type = 'expert-note' AND length(title) <= 200 AND length(symptoms) <= 2000 AND length(cause) <= 2000 AND length(what_to_check_first) <= 2000);

INSERT INTO public.knowledge_notes (title, symptoms, cause, what_to_check_first, contributed_by, source_type) VALUES
('CPU down on a NonStop node', 'A CPU shows DOWN in SCF STATUS CPU; EMS reports a CPU halt; load rises on surviving CPUs.', 'Hardware or OS halt; process pairs fail over to backups on other CPUs.', 'Run SCF STATUS CPU * to confirm which CPU is down and how load redistributed.', 'HPE NonStop operations guide (fictional excerpt)', 'hpe-doc'),
('TMF health and audit trail capacity', 'Transaction latency rises; commits slow; audit trail filling.', 'TMF audit trail near capacity or TMF not fully STARTED.', 'Run TMFCOM STATUS TMF; confirm STARTED and audit trail below 80%.', 'HPE TMF reference (fictional excerpt)', 'hpe-doc'),
('Payment latency after CPU 2 failure (2024)', 'Payment authorization latency climbed to ~1s after a CPU failure; CPUs hosting backups at 90%.', '$PAYAUTH primary and backup ended up on the same overloaded CPUs after takeover.', 'Check CPU load first, then restart $PAYAUTH during a low-traffic window to rebalance.', 'Incident INC-18822 postmortem', 'past-incident'),
('Disk path lost on $DATA02', 'SCF STATUS DISK shows MIRROR ONLY; no latency impact.', 'One disk path failed; volume running on mirror.', 'Run SCF STATUS DISK $* and log a hardware call; do not restart processes for this.', 'Incident INC-19107 postmortem', 'past-incident'),
('Check TMF before restarting anything', 'CPU failover just happened and latency is high; temptation to restart processes.', 'Failovers often leave TMF backing out in-flight transactions; restarting mid-backout makes it worse.', 'When CPU failover happens, check transaction manager status (TMFCOM STATUS TMF) before restarting anything.', 'R. Nguyen, retired senior operator (32 yrs)', 'expert-note'),
('Gather Measure evidence before high-risk actions', 'Load looks uneven but the cause is unclear.', 'Without data, operators restart the wrong process.', 'Start a Measure collection (MEASCOM ADD CPU *) for a few minutes so you have evidence before any restart.', 'R. Nguyen, retired senior operator (32 yrs)', 'expert-note');
CREATE TABLE public.playbooks (
  id text PRIMARY KEY,
  title text NOT NULL,
  author text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  trigger jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  stop_conditions text NOT NULL DEFAULT '',
  escalate_if text NOT NULL DEFAULT '',
  never_do jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.playbooks TO anon, authenticated;
GRANT ALL ON public.playbooks TO service_role;

ALTER TABLE public.playbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read playbooks"
ON public.playbooks FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Anyone can create draft playbooks"
ON public.playbooks FOR INSERT TO anon, authenticated
WITH CHECK (status = 'draft' AND length(title) <= 200 AND length(author) <= 100 AND jsonb_array_length(steps) <= 50);

CREATE POLICY "Anyone can update playbooks"
ON public.playbooks FOR UPDATE TO anon, authenticated
USING (true) WITH CHECK (status IN ('draft', 'approved'));

INSERT INTO public.playbooks (id, title, author, status, version, trigger, steps, stop_conditions, escalate_if, never_do, approved_by) VALUES
('PB-001', 'CPU failure — restore redundancy', 'R. Patel (fictional)', 'approved', 2,
 '[{"metric":"cpus_down","operator":">=","value":1}]'::jsonb,
 '[{"option_id":"C1","action":"STATUS PROCESS $ZZKRN.#*","why":"See which process pairs lost their backup after the CPU went down.","check_after":"Count of unprotected processes in the status panel."},{"option_id":"C3","action":"OPEN HARDWARE TICKET + NOTIFY ON-CALL","why":"The CPU cannot be restored until hardware is repaired; start the clock early.","check_after":"Engineer ETA acknowledged."},{"option_id":"C4","action":"THROTTLE BATCH QUEUE LOW","why":"Give payment transactions scheduling priority while redundancy is reduced.","check_after":"Response time trending down."},{"option_id":"C5","action":"START BACKUP FOR $PAYAUTH1 ON CPU 7","why":"Protect the most critical payment process first.","check_after":"No-backup counter drops by one."},{"option_id":"C6","action":"ABORT PROCESS $ZZKRN.#RPTGEN","why":"Free CPUs 4-6 from the report generator so payment load rebalances.","check_after":"Response time under 300 ms."},{"option_id":"C7","action":"RESTORE CPU 3","why":"Only after the engineer confirms the hardware is repaired; needs a second operator.","check_after":"Redundancy back to FULL."}]'::jsonb,
 'Latency under 300 ms and no processes running without a backup.',
 'Latency above 1400 ms after RESTORE CPU 3, or a second CPU fails.',
 '["C8"]'::jsonb, 'M. Chen (fictional)'),
('PB-002', 'Disk degradation — protect I/O', 'R. Patel (fictional)', 'approved', 1,
 '[{"metric":"avg_response_ms","operator":">","value":400},{"metric":"cpus_down","operator":"=","value":0}]'::jsonb,
 '[{"option_id":"D1","action":"SCF STATUS DISK $DATA01, DETAIL","why":"Confirm which path is failing and whether the standby volume is available.","check_after":"Primary path error count."},{"option_id":"D2","action":"SWITCH STORAGE PATH $DATA01","why":"Move I/O to the healthy alternate path before anything riskier.","check_after":"Response time back near 300 ms."},{"option_id":"D3","action":"PAUSE REPORTING JOBS ON $DATA01","why":"Take reporting load off the volume so a later revive does not saturate the disk.","check_after":"Disk queue length easing."},{"option_id":"D4","action":"REVIVE MIRROR $DATA01","why":"Re-sync the mirror only after reporting jobs are paused.","check_after":"Redundancy back to FULL."}]'::jsonb,
 'Latency under 300 ms and redundancy FULL.',
 'Mirror side B also reports errors, or latency above 900 ms after the path switch.',
 '["D7"]'::jsonb, 'M. Chen (fictional)'),
('PB-003', 'Transaction backlog — drain the queue', 'T. Okonkwo (fictional)', 'draft', 1,
 '[{"metric":"queue_depth","operator":">","value":1000}]'::jsonb,
 '[{"option_id":"T1","action":"GET STATISTICS","why":"Confirm it is lock contention, not disk or CPU.","check_after":"Lock Wait high with normal Disk I/Os."},{"option_id":"T2","action":"TMFCOM STATUS TRANSACTIONS","why":"Find the oldest transaction and its owner.","check_after":"Owner identified."},{"option_id":"T4","action":"NOTIFY APPLICATION OWNER","why":"Never abort a business transaction without owner approval.","check_after":"Owner responds."},{"option_id":"T6","action":"ABORT TRANSACTION 4821","why":"Release the locks only after the owner confirms it is blocked.","check_after":"Queue drains under 200."}]'::jsonb,
 'Queue under 200 and latency under 300 ms.',
 'Queue still growing after the abort, or a second long-running transaction appears.',
 '["T7"]'::jsonb, NULL);
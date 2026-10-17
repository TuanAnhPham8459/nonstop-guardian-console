CREATE TABLE public.simulation_sessions (owner_hash text PRIMARY KEY, revision bigint NOT NULL DEFAULT 0, snapshot jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
GRANT ALL ON public.simulation_sessions TO service_role;
ALTER TABLE public.simulation_sessions ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION public.commit_simulation(p_owner text, p_revision bigint, p_snapshot jsonb, p_events jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 UPDATE public.simulation_sessions SET snapshot=p_snapshot, revision=revision+1, updated_at=now() WHERE owner_hash=p_owner AND revision=p_revision;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO public.audit_log(session_id,actor,event_type,command,output,detail) SELECT p_snapshot->>'sessionId','system','output',e->>'command',e->>'output',e->>'detail' FROM jsonb_array_elements(p_events) e;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.commit_simulation(text,bigint,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_simulation(text,bigint,jsonb,jsonb) TO service_role;
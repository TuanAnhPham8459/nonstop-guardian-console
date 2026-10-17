ALTER TABLE public.knowledge_notes ADD COLUMN advice TEXT;
UPDATE public.knowledge_notes SET advice = what_to_check_first WHERE advice IS NULL;
COMMENT ON COLUMN public.knowledge_notes.symptoms IS 'DEPRECATED: notes now use advice';
COMMENT ON COLUMN public.knowledge_notes.cause IS 'DEPRECATED: notes now use advice';
COMMENT ON COLUMN public.knowledge_notes.what_to_check_first IS 'DEPRECATED: notes now use advice';
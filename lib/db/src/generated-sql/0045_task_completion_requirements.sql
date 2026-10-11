CREATE FUNCTION public.acos_valid_completion_requirements(requirements jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  requirement jsonb;
  operation text;
  seen text[] := ARRAY[]::text[];
BEGIN
  IF requirements IS NULL OR jsonb_typeof(requirements) <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(requirements) > 8 THEN
    RETURN false;
  END IF;
  FOR requirement IN SELECT value FROM jsonb_array_elements(requirements) LOOP
    IF jsonb_typeof(requirement) <> 'object' THEN
      RETURN false;
    END IF;
    IF NOT (requirement ? 'kind' AND requirement ? 'tool')
      OR (SELECT count(*) FROM jsonb_object_keys(requirement)) <> 2 THEN
      RETURN false;
    END IF;
    IF requirement->>'kind' <> 'tool_succeeded'
      OR jsonb_typeof(requirement->'kind') <> 'string'
      OR jsonb_typeof(requirement->'tool') <> 'string' THEN
      RETURN false;
    END IF;
    operation := requirement->>'tool';
    IF operation !~ '^[a-zA-Z][a-zA-Z0-9_]{0,79}$'
      OR operation = ANY(ARRAY[
        'complete_task', 'request_approval', 'request_user_input',
        'delegate_task', 'create_sub_agent', 'update_task_progress',
        'load_tools', 'list_skills', 'read_skill', 'list_extensions',
        'log_note', 'post_company_message', 'vm_codex_task'
      ]::text[])
      OR operation = ANY(seen) THEN
      RETURN false;
    END IF;
    seen := array_append(seen, operation);
  END LOOP;
  RETURN true;
END;
$$;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completion_requirements" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completion_requirements_check" CHECK (public.acos_valid_completion_requirements("tasks"."completion_requirements"));

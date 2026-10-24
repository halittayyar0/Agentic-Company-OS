CREATE FUNCTION public.acos_valid_task_result_format(layout jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  item jsonb;
  heading text;
  glyph text;
  units integer;
  seen text[] := ARRAY[]::text[];
  trim_chars text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF layout IS NULL OR jsonb_typeof(layout) = 'null' THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(layout) <> 'object' THEN
    RETURN false;
  END IF;
  IF NOT (layout ? 'kind' AND layout ? 'columns')
    OR (SELECT count(*) FROM jsonb_object_keys(layout)) <> 2 THEN
    RETURN false;
  END IF;
  IF jsonb_typeof(layout->'kind') <> 'string'
    OR layout->>'kind' <> 'table'
    OR jsonb_typeof(layout->'columns') <> 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(layout->'columns') < 2
    OR jsonb_array_length(layout->'columns') > 8 THEN
    RETURN false;
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(layout->'columns') LOOP
    IF jsonb_typeof(item) <> 'string' THEN RETURN false; END IF;
    heading := item #>> '{}';
    IF char_length(heading) = 0 OR char_length(heading) > 80
      OR octet_length(heading) > 320
      OR btrim(heading, trim_chars) <> heading
      OR (heading COLLATE "C") = ANY(seen) THEN
      RETURN false;
    END IF;
    units := 0;
    FOR glyph IN SELECT part FROM regexp_split_to_table(heading, '') AS parts(part) WHERE part <> '' LOOP
      IF ascii(glyph) < 32 OR ascii(glyph) = 127 THEN RETURN false; END IF;
      units := units + CASE WHEN octet_length(glyph) = 4 THEN 2 ELSE 1 END;
    END LOOP;
    IF units > 80 THEN RETURN false; END IF;
    seen := array_append(seen, heading);
  END LOOP;
  RETURN true;
END;
$$;
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "result_format" jsonb;
--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_result_format_check" CHECK (public.acos_valid_task_result_format("tasks"."result_format"));

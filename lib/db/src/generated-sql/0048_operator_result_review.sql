CREATE FUNCTION public.acos_valid_completion_proposal(proposal jsonb, task_id integer, agent_id integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  item jsonb;
  seen text[] := ARRAY[]::text[];
  field_name text;
  units integer;
  invalid_control boolean;
  trim_chars text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
BEGIN
  IF proposal IS NULL OR jsonb_typeof(proposal) <> 'object' OR octet_length(proposal::text) > 300000
    OR (SELECT count(*) FROM jsonb_object_keys(proposal)) <> 13
    OR NOT (proposal ?& ARRAY['schemaVersion','taskId','ownerAgentId','ownerConfigVersion','cycleNumber','cycleStartedAt','originAttemptId','judgeReviewId','judgeReasonCode','contextHash','resultSummary','resultSummaryHash','sourceReceipts'])
    THEN RETURN false; END IF;
  IF proposal->'schemaVersion' <> '1'::jsonb
    OR proposal->'taskId' <> to_jsonb(task_id) OR proposal->'ownerAgentId' <> to_jsonb(agent_id)
    OR jsonb_typeof(proposal->'cycleNumber') <> 'number' OR (proposal->>'cycleNumber') !~ '^[0-9]+$'
    OR (proposal->>'cycleNumber')::numeric > 2147483647
    OR jsonb_typeof(proposal->'judgeReviewId') <> 'number' OR (proposal->>'judgeReviewId') !~ '^[1-9][0-9]*$'
    OR (proposal->>'judgeReviewId')::numeric > 2147483647
    OR jsonb_typeof(proposal->'judgeReasonCode') <> 'string'
    OR proposal->>'judgeReasonCode' NOT IN ('source_mismatch','missing_required_action','unauthorized_action','insufficient_evidence')
    THEN RETURN false; END IF;
  FOREACH field_name IN ARRAY ARRAY['ownerConfigVersion','contextHash','resultSummaryHash'] LOOP
    IF jsonb_typeof(proposal->field_name) <> 'string' OR (proposal->>field_name) !~ '^[0-9a-f]{64}$'
      THEN RETURN false; END IF;
  END LOOP;
  IF jsonb_typeof(proposal->'originAttemptId') <> 'string'
    OR (proposal->>'originAttemptId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(proposal->'cycleStartedAt') <> 'string'
    OR (proposal->>'cycleStartedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR NOT isfinite((proposal->>'cycleStartedAt')::timestamptz)
    OR jsonb_typeof(proposal->'resultSummary') <> 'string'
    OR char_length(proposal->>'resultSummary') NOT BETWEEN 1 AND 65536
    OR btrim(proposal->>'resultSummary', trim_chars) <> proposal->>'resultSummary'
    THEN RETURN false; END IF;
  SELECT coalesce(sum(CASE WHEN octet_length(glyph) = 4 THEN 2 ELSE 1 END), 0),
    coalesce(bool_or((ascii(glyph) < 32 AND ascii(glyph) NOT IN (9,10,13)) OR ascii(glyph) = 127), false)
    INTO units, invalid_control
    FROM regexp_split_to_table(proposal->>'resultSummary', '') AS parts(glyph) WHERE glyph <> '';
  IF units > 65536 OR invalid_control OR jsonb_typeof(proposal->'sourceReceipts') <> 'array'
    OR jsonb_array_length(proposal->'sourceReceipts') NOT BETWEEN 1 AND 4 THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(proposal->'sourceReceipts') LOOP
    IF jsonb_typeof(item) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 4
      OR NOT (item ?& ARRAY['receiptId','argumentHash','fileSha256','byteCount'])
      OR jsonb_typeof(item->'receiptId') <> 'string' OR char_length(item->>'receiptId') NOT BETWEEN 1 AND 120
      OR btrim(item->>'receiptId', trim_chars) <> item->>'receiptId'
      OR (item->>'receiptId') ~ '[[:cntrl:]]' OR item->>'receiptId' = ANY(seen)
      OR jsonb_typeof(item->'byteCount') <> 'number' OR (item->>'byteCount') !~ '^[0-9]+$'
      OR (item->>'byteCount')::numeric > 4096 THEN RETURN false; END IF;
    FOREACH field_name IN ARRAY ARRAY['argumentHash','fileSha256'] LOOP
      IF jsonb_typeof(item->field_name) <> 'string' OR (item->>field_name) !~ '^[0-9a-f]{64}$'
        THEN RETURN false; END IF;
    END LOOP;
    seen := array_append(seen, item->>'receiptId');
  END LOOP;
  RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD COLUMN "completion_proposal" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completion_authority" text;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_pending_result_review_idx" ON "approval_requests" USING btree ("task_id") WHERE "approval_requests"."status" = 'pending' and "approval_requests"."scope"->>'toolName' = 'operator_confirm_task_result';--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_result_review_check" CHECK (coalesce((
        ("approval_requests"."completion_proposal" is null and coalesce("approval_requests"."scope"->>'toolName', '') <> 'operator_confirm_task_result')
        or (
          "approval_requests"."scope"->>'toolName' = 'operator_confirm_task_result'
          and "approval_requests"."action_payload" is null
          and "approval_requests"."automatic_policy_revision" is null
          and "approval_requests"."category" = 'other' and "approval_requests"."amount_usd" is null
          and "approval_requests"."expires_at" is not null and "approval_requests"."expires_at" > "approval_requests"."created_at"
          and "approval_requests"."expires_at" <= "approval_requests"."created_at" + interval '24 hours'
          and "approval_requests"."browser_runtime_instance_id" is null
          and (
            ("approval_requests"."status" = 'pending' and "approval_requests"."consumed_at" is null
              and "approval_requests"."resolved_at" is null and "approval_requests"."completion_proposal" is not null
              and public.acos_valid_completion_proposal("approval_requests"."completion_proposal", "approval_requests"."task_id", "approval_requests"."agent_id"))
            or ("approval_requests"."status" <> 'pending' and "approval_requests"."completion_proposal" is null)
          )
        )
      ), false));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completion_authority_check" CHECK ("tasks"."completion_authority" is null or ("tasks"."completion_authority" in ('agent', 'operator') and "tasks"."result_summary" is not null));

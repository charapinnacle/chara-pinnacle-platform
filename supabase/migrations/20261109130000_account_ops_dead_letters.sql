-- Abandoned account-ops jobs are kept as dead letters (security review SA-14; ARCHITECTURE.md section 13 "archive as
-- dead-letter"). Until now a job read more than account_ops_max_attempts times was deleted and only its action and
-- message id were audited, so an abandoned delete_object lost the bucket and the path of the object it was to remove.
-- The message now moves to pgmq.a_account_ops, where the operator finds it by the msg_id of the account_ops_abandoned
-- row and queues it again (docs/runbooks/platform-staff.md). The audit row stays as it was: the path holds the file name,
-- which audit rows never carry (NFR-C1, private.worker_documents_audit), and audit rows are archived for good. The dead
-- letters are kept for the period of the retention row account_ops_archive (20261109140000).
create or replace function public.account_ops_dequeue(p_limit integer default 25) returns table (msg_id bigint, message jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max integer := (select (value #>> '{}')::integer from private.settings where key = 'account_ops_max_attempts');
  v_job pgmq.message_record;
  v_type text;
  v_entity text;
begin
  for v_job in select * from pgmq.read('account_ops', 60, least(greatest(coalesce(p_limit, 25), 1), 100)) loop
    if v_job.read_ct > v_max then
      perform pgmq.archive('account_ops', v_job.msg_id);
      select e.entity_type, e.entity_id into v_type, v_entity from private.account_ops_entity(v_job.message) e;
      perform audit.record(
        'account_ops_abandoned', v_type, v_entity,
        jsonb_build_object('action', v_job.message ->> 'action', 'msg_id', v_job.msg_id)
      );
    else
      if v_job.read_ct > 1 then
        perform pgmq.set_vt('account_ops', v_job.msg_id, 60 * v_job.read_ct);
      end if;
      msg_id := v_job.msg_id;
      message := v_job.message;
      return next;
    end if;
  end loop;
end;
$$;

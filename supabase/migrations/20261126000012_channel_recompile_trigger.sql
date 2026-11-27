-- Any voice/messaging setting change marks the agent for recompilation (agent-compile sweep or explicit compile).
create or replace function public.mark_channel_recompile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (to_jsonb(new) - array['compiled_prompt','compiled_hash','template_version','compiled_at','updated_at'])
     is distinct from (to_jsonb(old) - array['compiled_prompt','compiled_hash','template_version','compiled_at','updated_at']) then
    update public.agent_blueprints set pending_compile = true where agent_id = new.agent_id;
  end if;
  return new;
end $$;
create trigger trg_channel_recompile after update on public.channel_configs for each row execute function public.mark_channel_recompile();

-- Availability edits also need recompilation (hours are part of the prompts).
create or replace function public.mark_rules_recompile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.agent_blueprints set pending_compile = true where agent_id = coalesce(new.agent_id, old.agent_id);
  return coalesce(new, old);
end $$;
create trigger trg_rules_recompile after insert or update or delete on public.availability_rules for each row execute function public.mark_rules_recompile();

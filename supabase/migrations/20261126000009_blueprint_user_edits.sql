-- Owner edits from the Blueprint panel: set a dotted path, lock it (Orchestrator won't overwrite), bump version.
create or replace function public.update_blueprint_field(p_agent uuid, p_path text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  bp public.agent_blueprints;
  keys text[] := string_to_array(p_path, '.');
  new_data jsonb;
begin
  if not public.is_member(public.agent_workspace(p_agent)) then raise exception 'not_found'; end if;
  if p_path !~ '^(business\.(name|industry|description|address|service_area|website|timezone|currency)|hours|policies\.[a-z_]+(\.[a-z_]+)?|collect_fields|goal|tone|notes|emergency_rule|response_time)$' then
    raise exception 'invalid_path';
  end if;
  select * into bp from public.agent_blueprints where agent_id = p_agent for update;
  if p_value is null or p_value = 'null'::jsonb or p_value = '""'::jsonb then
    new_data := bp.data #- keys;
  else
    -- ensure parent objects exist
    if array_length(keys, 1) > 1 and (bp.data #> keys[1:array_length(keys,1)-1]) is null then
      bp.data := jsonb_set(bp.data, keys[1:array_length(keys,1)-1], '{}'::jsonb, true);
    end if;
    new_data := jsonb_set(bp.data, keys, p_value, true);
  end if;
  update public.agent_blueprints set
    data = new_data,
    field_meta = jsonb_set(coalesce(field_meta, '{}'::jsonb), array[p_path], jsonb_build_object('source','user','locked', true, 'updated_at', now()), true),
    version = version + 1,
    pending_compile = true
  where agent_id = p_agent;
  insert into public.agent_blueprint_versions (agent_id, version, snapshot, change_summary, changed_by)
  values (p_agent, bp.version + 1, jsonb_build_object('blueprint', new_data), 'Edited ' || p_path, 'user');
  return new_data;
end $$;

create or replace function public.unlock_blueprint_field(p_agent uuid, p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(public.agent_workspace(p_agent)) then raise exception 'not_found'; end if;
  update public.agent_blueprints set field_meta = field_meta - p_path where agent_id = p_agent;
end $$;

grant execute on function public.update_blueprint_field, public.unlock_blueprint_field to authenticated;

-- "Use the same information for the Messaging Agent": share knowledge + copy calling settings (welcome text is generated at compile).
create or replace function public.use_same_info_for_messaging(p_agent uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c public.channel_configs;
begin
  if not public.is_member(public.agent_workspace(p_agent)) then raise exception 'not_found'; end if;
  update public.catalog_items set in_messaging = in_calling where agent_id = p_agent;
  update public.faqs set in_messaging = in_calling where agent_id = p_agent;
  select * into c from public.channel_configs where agent_id = p_agent and channel = 'calling';
  update public.channel_configs set
    language = c.language, adapt_language = c.adapt_language, persona_style = c.persona_style,
    custom_instructions = c.custom_instructions, synced_from_calling = true
  where agent_id = p_agent and channel = 'messaging';
  update public.agent_blueprints set pending_compile = true where agent_id = p_agent;
end $$;
grant execute on function public.use_same_info_for_messaging to authenticated;

-- Owners choose the currency their prices are in. Changing it relabels existing catalog prices that used the old
-- currency (the numbers stay the same: they were entered in the owner's own terms), without marking AI items as user-edited.
create or replace function public.set_business_currency(p_agent uuid, p_currency text)
returns int language plpgsql security definer set search_path = public as $$
declare v_old text; v_new text := upper(trim(p_currency)); n int;
begin
  if not public.is_member(public.agent_workspace(p_agent)) then raise exception 'not_found'; end if;
  if v_new !~ '^[A-Z]{3}$' then raise exception 'invalid_currency'; end if;

  select coalesce(b.data #>> '{business,currency}', w.currency) into v_old
  from public.agents a
  join public.workspaces w on w.id = a.workspace_id
  left join public.agent_blueprints b on b.agent_id = a.id
  where a.id = p_agent;

  perform public.update_blueprint_field(p_agent, 'business.currency', to_jsonb(v_new));

  -- Relabel only; this is not a content edit by the owner, so keep AI/document items unlocked.
  perform set_config('request.jwt.claims', '{}', true);
  update public.catalog_items set currency = v_new
  where agent_id = p_agent and (currency is null or currency = v_old) and currency is distinct from v_new;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.set_business_currency from public, anon;
grant execute on function public.set_business_currency to authenticated;

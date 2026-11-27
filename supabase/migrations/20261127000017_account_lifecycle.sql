-- Phase 10: account lifecycle (30-day deletion grace), credit reminders, support contacts, hardening.

-- ── Hardening: agent status and deletion only through Edge Functions (they check email, credits, WhatsApp, engine cleanup).
revoke update (status, pause_reason) on public.agents from authenticated;
revoke delete on public.agents from authenticated;
drop policy if exists "owners delete agents" on public.agents;

-- ── Workspace deletion with a 30-day grace period.
alter table public.workspaces drop constraint if exists workspaces_status_check;
alter table public.workspaces add constraint workspaces_status_check check (status in ('active','suspended','pending_deletion'));
alter table public.workspaces
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists deletion_scheduled_for timestamptz,
  add column if not exists deletion_reason text check (char_length(deletion_reason) <= 500),
  add column if not exists low_balance_notified_at timestamptz;
create index if not exists workspaces_deletion_idx on public.workspaces (deletion_scheduled_for) where status = 'pending_deletion';

alter table public.credit_lots add column if not exists expiry_reminded_at timestamptz;

-- ── Support contacts (customers see the email; priority WhatsApp only on plans that include it).
insert into public.platform_settings (key, value)
values ('support', '{"email":"hello@buildstart.io","priority_whatsapp":"","onboarding_url":""}')
on conflict (key) do nothing;

create or replace function public.support_contacts()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'email', coalesce(nullif(s.value->>'email', ''), 'hello@buildstart.io'),
    'priority_whatsapp', case when p.key = 'enterprise' then nullif(s.value->>'priority_whatsapp', '') end,
    'onboarding_url', case when p.key in ('pro','enterprise') then nullif(s.value->>'onboarding_url', '') end
  )
  from (select value from public.platform_settings where key = 'support') s
  left join lateral (
    select pl.key from public.workspace_members m join public.workspaces w on w.id = m.workspace_id join public.plans pl on pl.id = w.plan_id
    where m.user_id = auth.uid() limit 1
  ) p on true;
$$;
revoke execute on function public.support_contacts from public, anon;
grant execute on function public.support_contacts to authenticated;

-- ── Credit reminders: top-up expiry (14 days ahead, once per lot) and low balance (once per plan period).
create or replace function public.credit_reminders()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n_exp int := 0; n_low int := 0; pct numeric;
begin
  for r in
    select l.workspace_id, sum(l.remaining) as amount, min(l.expires_at) as expires_at, array_agg(l.id) as ids
    from public.credit_lots l join public.workspaces w on w.id = l.workspace_id and w.status = 'active'
    where l.kind = 'topup' and l.remaining >= 1 and l.expiry_reminded_at is null
      and l.expires_at > now() and l.expires_at <= now() + interval '14 days'
    group by l.workspace_id
  loop
    insert into public.notifications (workspace_id, type, title, body, link)
    values (r.workspace_id, 'billing', '⏳ ' || floor(r.amount)::text || ' top-up credits expire soon',
            'They expire on ' || to_char(r.expires_at at time zone 'UTC', 'Mon DD, YYYY') || '. Use them before then. Unused top-up credits can''t be refunded.', '/app/usage');
    update public.credit_lots set expiry_reminded_at = now() where id = any(r.ids);
    n_exp := n_exp + 1;
  end loop;

  select coalesce((value #>> '{}')::numeric, 20) into pct from public.platform_settings where key = 'low_credit_threshold_pct';
  pct := coalesce(pct, 20);
  for r in
    select w.id, b.total, p.monthly_credits
    from public.workspaces w
    join public.wallet_balance b on b.workspace_id = w.id
    left join public.plans p on p.id = w.plan_id
    where w.status = 'active'
      and (w.low_balance_notified_at is null or w.low_balance_notified_at < coalesce(w.plan_period_start, now() - interval '30 days'))
      and b.total < greatest(5, coalesce(p.monthly_credits, 15) * pct / 100)
      and exists (select 1 from public.agents a where a.workspace_id = w.id and a.status in ('live','paused'))
  loop
    insert into public.notifications (workspace_id, type, title, body, link)
    values (r.id, 'billing',
            case when r.total <= 0 then '🔴 You''re out of credits' else '🟡 Credits running low' end,
            case when r.total <= 0 then 'Your agents pause when credits run out. Top up or upgrade to keep them answering.'
                 else 'You have ' || round(r.total, 1)::text || ' credits left. Top up or upgrade so your agents keep answering.' end,
            '/app/billing');
    update public.workspaces set low_balance_notified_at = now() where id = r.id;
    n_low := n_low + 1;
  end loop;
  return jsonb_build_object('expiry', n_exp, 'low', n_low);
end $$;
revoke execute on function public.credit_reminders from public, anon, authenticated;

-- Hourly: cycles, expiry and reminders. Daily: purge workspaces whose grace period ended.
do $$ begin
  perform cron.unschedule('bs-credit-cycles');
exception when others then null; end $$;
select cron.schedule('bs-credit-cycles', '7 * * * *', $$select public.run_free_plan_cycles(); select public.expire_lots(); select public.credit_reminders();$$);
do $$ begin
  perform cron.unschedule('bs-account-purge');
exception when others then null; end $$;
select cron.schedule('bs-account-purge', '23 3 * * *', $$select public.invoke_edge('account', '{"action":"purge"}'::jsonb);$$);

-- Deleting a user must never be blocked by audit-style references.
alter table public.campaigns drop constraint if exists campaigns_consent_attested_by_fkey,
  add constraint campaigns_consent_attested_by_fkey foreign key (consent_attested_by) references auth.users(id) on delete set null;
alter table public.campaigns drop constraint if exists campaigns_created_by_fkey,
  add constraint campaigns_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null;

-- ── Recording & transcript retention by plan (limits.recording_retention_days). The engine-side audio file is also
--    requested for deletion by the account function when the engine supports it; access is blocked from here on.
alter table public.calls add column if not exists recording_expired_at timestamptz;
create or replace function public.apply_recording_retention()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.calls c set transcript = '[]'::jsonb, recording_expired_at = now()
  from public.workspaces w left join public.plans p on p.id = w.plan_id
  where c.workspace_id = w.id and c.recording_expired_at is null
    and c.created_at < now() - make_interval(days => coalesce((p.limits->>'recording_retention_days')::int, 30));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.apply_recording_retention from public, anon, authenticated;
do $$ begin
  perform cron.unschedule('bs-retention');
exception when others then null; end $$;
select cron.schedule('bs-retention', '41 2 * * *', $$select public.apply_recording_retention();$$);

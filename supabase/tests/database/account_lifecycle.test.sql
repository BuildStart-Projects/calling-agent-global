begin;
select plan(13);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
('a1111111-1111-1111-1111-111111111111', 'life@test.dev', '{}', 'authenticated', 'authenticated');
insert into public.agents (id, workspace_id, name, type, status)
select 'a2222222-2222-2222-2222-222222222222', w.id, 'Desk', 'booking', 'paused' from public.workspaces w where w.owner_id = 'a1111111-1111-1111-1111-111111111111';

-- ── Members can't flip agent status or delete agents directly (only via Edge Functions).
set local role authenticated;
set local request.jwt.claims = '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local request.jwt.claim.sub = 'a1111111-1111-1111-1111-111111111111';
select throws_ok($$ update public.agents set status = 'live' where id = 'a2222222-2222-2222-2222-222222222222' $$, '42501', null, 'member cannot set agent live directly');
select throws_ok($$ delete from public.agents where id = 'a2222222-2222-2222-2222-222222222222' $$, '42501', null, 'member cannot delete agent directly');
select lives_ok($$ update public.agents set name = 'Front desk' where id = 'a2222222-2222-2222-2222-222222222222' $$, 'member can still rename agent');
select throws_ok($$ update public.workspaces set status = 'active' $$, '42501', null, 'member cannot change workspace status');
select throws_ok($$ update public.workspaces set deletion_scheduled_for = null $$, '42501', null, 'member cannot cancel a scheduled deletion');
select is((public.support_contacts())->>'email', 'hello@buildstart.io', 'support email visible to customers');
select ok((public.support_contacts())->>'priority_whatsapp' is null, 'priority WhatsApp hidden on Free');
reset role;

-- ── Top-up expiry reminder: once per lot.
insert into public.credit_lots (workspace_id, kind, granted, remaining, expires_at)
select id, 'topup', 50, 30, now() + interval '5 days' from public.workspaces where owner_id = 'a1111111-1111-1111-1111-111111111111';
select public.credit_reminders();
select is((select count(*)::int from public.notifications n join public.workspaces w on w.id = n.workspace_id where w.owner_id = 'a1111111-1111-1111-1111-111111111111' and n.title like '%top-up credits expire soon'), 1, 'expiry reminder sent');
select public.credit_reminders();
select is((select count(*)::int from public.notifications n join public.workspaces w on w.id = n.workspace_id where w.owner_id = 'a1111111-1111-1111-1111-111111111111' and n.title like '%top-up credits expire soon'), 1, 'expiry reminder not repeated');

-- ── Low balance: spend down, one notification per period.
update public.credit_lots set remaining = 0 where workspace_id = (select id from public.workspaces where owner_id = 'a1111111-1111-1111-1111-111111111111');
select public.credit_reminders();
select is((select count(*)::int from public.notifications n join public.workspaces w on w.id = n.workspace_id where w.owner_id = 'a1111111-1111-1111-1111-111111111111' and n.title like '%out of credits'), 1, 'out-of-credits alert sent');
select public.credit_reminders();
select is((select count(*)::int from public.notifications n join public.workspaces w on w.id = n.workspace_id where w.owner_id = 'a1111111-1111-1111-1111-111111111111' and n.title like '%out of credits'), 1, 'low-balance alert once per period');

-- ── Recording retention (Free = 30 days).
insert into public.calls (agent_id, workspace_id, engine_call_id, direction, transcript, recording_key, created_at)
select a.id, a.workspace_id, x.cid, 'inbound', '[{"role":"user","text":"hi"}]', 'k', x.ts
from public.agents a, (values ('old-call', now() - interval '40 days'), ('new-call', now() - interval '2 days')) as x(cid, ts)
where a.id = 'a2222222-2222-2222-2222-222222222222';
select public.apply_recording_retention();
select ok((select recording_expired_at is not null and transcript = '[]'::jsonb from public.calls where engine_call_id = 'old-call'), 'old recording expired and transcript cleared');
select ok((select recording_expired_at is null and jsonb_array_length(transcript) = 1 from public.calls where engine_call_id = 'new-call'), 'recent recording kept');

select * from finish();
rollback;

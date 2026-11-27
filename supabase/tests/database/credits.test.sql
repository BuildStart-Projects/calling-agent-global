begin;
select plan(16);

-- Fixture: a user created through auth triggers signup bootstrap (profile, workspace, Free plan, 15 credits).
insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('11111111-1111-1111-1111-111111111111', 'owner@test.dev', '{"full_name":"Ada Lovelace","timezone":"Europe/London","country":"gb","currency":"gbp"}', 'authenticated', 'authenticated');

select is((select count(*)::int from public.workspaces where owner_id = '11111111-1111-1111-1111-111111111111'), 1, 'signup creates one workspace');
select is((select timezone from public.workspaces where owner_id = '11111111-1111-1111-1111-111111111111'), 'Europe/London', 'timezone taken from signup metadata');
select is((select currency from public.workspaces where owner_id = '11111111-1111-1111-1111-111111111111'), 'GBP', 'currency upper-cased');
select is((select p.key from public.workspaces w join public.plans p on p.id = w.plan_id where w.owner_id = '11111111-1111-1111-1111-111111111111'), 'free', 'new workspace starts on Free');

create temp table ws as select id from public.workspaces where owner_id = '11111111-1111-1111-1111-111111111111';
select is(public.wallet_total((select id from ws)), 15.0000::numeric, 'Free plan grants 15 credits');

-- Top-up (expires in a year) then usage: plan credits (expire sooner) must be spent first.
select public.grant_credits((select id from ws), 'topup', 50, now() + interval '365 days', 'topup', 'pi_test', null);
select is(public.wallet_total((select id from ws)), 65.0000::numeric, 'top-up adds 50');

-- 10 call minutes at 1 credit/min
select public.consume_credits((select id from ws), null, 'calling', 'call_minutes', 0, 0, 600);
select is((select remaining from public.credit_lots where workspace_id = (select id from ws) and kind = 'plan'), 5.0000::numeric, 'plan lot is debited first');
select is((select remaining from public.credit_lots where workspace_id = (select id from ws) and kind = 'topup'), 50.0000::numeric, 'top-up untouched while plan credits remain');

-- Messaging tokens: 1M in = 25, 1M out = 100 → 100k in + 10k out = 2.5 + 1 = 3.5
select is((public.consume_credits((select id from ws), null, 'messaging', 'messaging_tokens', 100000, 10000)->>'credits')::numeric, 3.5000::numeric, 'token pricing per 1M');
select is(public.wallet_total((select id from ws)), 51.5000::numeric, 'balance after mixed usage');

-- New period: unused plan credits do not roll over.
select public.start_plan_period((select id from ws), (select id from public.plans where key = 'pro'), now(), now() + interval '1 month', 'in_test');
select is((select sum(remaining) from public.credit_lots where workspace_id = (select id from ws) and kind = 'plan'), 100.0000::numeric, 'Pro period grants 100; previous plan remainder expired');
select ok(exists(select 1 from public.credit_ledger where workspace_id = (select id from ws) and reason = 'plan_expiry'), 'plan expiry recorded in ledger');

-- Overspend creates debt, next grant settles it.
select public.consume_credits((select id from ws), null, 'calling', 'call_minutes', 0, 0, 160 * 60);
select is(public.wallet_total((select id from ws)), -10.0000::numeric, 'overspend leaves a negative balance (debt)');
select public.grant_credits((select id from ws), 'topup', 50, now() + interval '365 days', 'topup', 'pi_test2', null);
select is(public.wallet_total((select id from ws)), 40.0000::numeric, 'next grant settles debt');

-- Expired top-ups are swept.
update public.credit_lots set expires_at = now() - interval '1 second' where workspace_id = (select id from ws) and kind = 'topup' and source_ref = 'pi_test2';
select ok(public.expire_lots() >= 1, 'expire_lots sweeps expired lots');

-- Agent limit (Pro = 3) enforced by create_agent.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.create_agent('booking'); select public.create_agent('order'); select public.create_agent('inquiry');
select throws_ok($$ select public.create_agent('booking') $$, 'agent_limit_reached', 'fourth agent blocked on Pro');

select * from finish();
rollback;

begin;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
('22222222-2222-2222-2222-222222222222', 'a@test.dev', '{}', 'authenticated', 'authenticated'),
('33333333-3333-3333-3333-333333333333', 'b@test.dev', '{}', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select is((select count(*)::int from public.workspaces), 1, 'user sees only own workspace');
select is((select count(*)::int from public.usage_events), 0, 'usage_events hidden from members');
select is((select count(*)::int from public.credit_rules), 0, 'credit rules hidden from members');
select is((select count(*)::int from public.wallet_balance), 1, 'wallet visible for own workspace only');
select throws_ok($$ update public.workspaces set plan_id = null $$, '42501', null, 'members cannot change plan_id');
select throws_ok($$ select public.grant_credits((select id from public.workspaces limit 1), 'bonus', 1000, null, 'bonus') $$, '42501', null, 'members cannot grant credits');

select * from finish();
rollback;

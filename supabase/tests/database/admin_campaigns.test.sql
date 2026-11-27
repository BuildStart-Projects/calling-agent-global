begin;
select plan(9);

insert into auth.users (id, email, raw_user_meta_data, aud, role) values
('44444444-4444-4444-4444-444444444444', 'admin@test.dev', '{}', 'authenticated', 'authenticated'),
('55555555-5555-5555-5555-555555555555', 'owner@test.dev', '{}', 'authenticated', 'authenticated'),
('66666666-6666-6666-6666-666666666666', 'other@test.dev', '{}', 'authenticated', 'authenticated');
insert into public.platform_admins (user_id) values ('44444444-4444-4444-4444-444444444444');

-- Campaign owned by 5555's workspace
insert into public.agents (id, workspace_id, name, type) select '77777777-7777-7777-7777-777777777777', w.id, 'Caller', 'inquiry' from public.workspaces w where w.owner_id = '55555555-5555-5555-5555-555555555555';
insert into public.campaigns (id, workspace_id, agent_id, name) select '88888888-8888-8888-8888-888888888888', workspace_id, id, 'Test' from public.agents where id = '77777777-7777-7777-7777-777777777777';
insert into public.campaign_targets (campaign_id, phone_e164) values ('88888888-8888-8888-8888-888888888888', '+94771234501');

set local role authenticated;

-- admin without MFA
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal1"}';
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select throws_ok($$ select public.admin_overview() $$, '42501', 'mfa_required', 'admin RPC requires MFA');

-- admin with MFA
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","aal":"aal2"}';
select lives_ok($$ select public.admin_overview() $$, 'admin with MFA can read overview');
select ok((select count(*) from public.admin_workspaces(null, 50, 0)) >= 3, 'admin sees all workspaces');
select is((select count(*)::int from public.campaign_targets where campaign_id = '88888888-8888-8888-8888-888888888888'), 1, 'admin can read any campaign targets');

-- campaign owner
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated","aal":"aal2"}';
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
select throws_ok($$ select public.admin_overview() $$, '42501', 'forbidden', 'non-admin blocked even with MFA');
select is((select count(*)::int from public.campaign_targets), 1, 'owner sees own campaign targets');
select throws_ok($$ insert into public.campaign_targets (campaign_id, phone_e164) values ('88888888-8888-8888-8888-888888888888', '+94770000000') $$, '42501', null, 'owners write targets only through the function');

-- another tenant
set local request.jwt.claims = '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';
set local request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';
select is((select count(*)::int from public.campaigns), 0, 'other tenant cannot see campaigns');
select is((select count(*)::int from public.campaign_targets), 0, 'other tenant cannot see targets');

select * from finish();
rollback;

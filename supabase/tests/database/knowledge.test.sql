begin;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('44444444-4444-4444-4444-444444444444', 'k@test.dev', '{"full_name":"Kim","timezone":"America/New_York","currency":"usd","locale":"en-US"}', 'authenticated', 'authenticated');

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}';
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

create temp table a on commit drop as select public.create_agent('booking', 'Bella') as id;
grant select on a to authenticated;

select is((select count(*)::int from public.channel_configs where agent_id = (select id from a)), 2, 'agent gets calling + messaging configs');
select is((select timezone from public.booking_settings where agent_id = (select id from a)), 'America/New_York', 'booking settings use workspace timezone');

-- Owner adds an item: gets a short ref and is locked (user source).
insert into public.catalog_items (agent_id, kind, name, price_minor, duration_minutes, ref) values ((select id from a), 'service', 'Haircut', 4000, 45, '');
select is((select ref from public.catalog_items where name = 'Haircut'), 's1', 'first service gets ref s1');
select ok((select locked from public.catalog_items where name = 'Haircut'), 'owner-created item is locked');
select is((select source from public.catalog_items where name = 'Haircut'), 'user', 'owner-created item has user source');

-- Toggling channel flags does not count as a content edit.
reset role;
update public.catalog_items set locked = false, source = 'ai' where name = 'Haircut';
set local role authenticated;
update public.catalog_items set in_messaging = false where name = 'Haircut';
select ok(not (select locked from public.catalog_items where name = 'Haircut'), 'flag toggle does not lock the item');
update public.catalog_items set price_minor = 4500 where name = 'Haircut';
select ok((select locked from public.catalog_items where name = 'Haircut'), 'price edit locks the item');

-- Blueprint field edit via RPC locks the path.
select public.update_blueprint_field((select id from a), 'business.name', '"Bella Salon"'::jsonb);
select is((select data #>> '{business,name}' from public.agent_blueprints where agent_id = (select id from a)), 'Bella Salon', 'blueprint field saved');
select ok((select (field_meta -> 'business.name' ->> 'locked')::boolean from public.agent_blueprints where agent_id = (select id from a)), 'edited path is locked');
select throws_ok($$ select public.update_blueprint_field((select id from a), 'plan_id', '"x"') $$, 'invalid_path', 'arbitrary paths rejected');

-- Handoff phone validation.
select lives_ok($$ select public.set_handoff_phone((select id from a), '+1 (415) 555-0123') $$, 'valid handoff number accepted');
select is((select handoff_phone_e164 from public.agents where id = (select id from a)), '+14155550123', 'handoff number normalised to E.164');

select * from finish();
rollback;

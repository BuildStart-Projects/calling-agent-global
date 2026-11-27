begin;
select plan(10);

insert into auth.users (id, email, raw_user_meta_data, aud, role)
values ('55555555-5555-5555-5555-555555555555', 'b@test.dev', '{"timezone":"UTC"}', 'authenticated', 'authenticated');
set local request.jwt.claims = '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';
set local request.jwt.claim.sub = '55555555-5555-5555-5555-555555555555';
create temp table t as select public.create_agent('booking', 'Cuts') as agent;

-- Every day 09:00–12:00, 60-min slots, capacity 1, no notice; a 60-min service.
insert into public.availability_rules (agent_id, weekday, start_time, end_time) select (select agent from t), d, '09:00', '12:00' from generate_series(0, 6) d;
update public.booking_settings set slot_interval_minutes = 60, capacity = 1, min_notice_minutes = 0, buffer_minutes = 0, timezone = 'UTC' where agent_id = (select agent from t);
insert into public.catalog_items (agent_id, kind, name, duration_minutes, price_minor, ref) values ((select agent from t), 'service', 'Cut', 60, 3000, '');
create temp table svc as select id from public.catalog_items where agent_id = (select agent from t);
create temp table day as select (current_date + 2) as d;

select is((select count(*)::int from public.get_available_slots((select agent from t), (select id from svc), (select d from day), (select d from day))), 3, '3 slots in a 9–12 window');

select is((public.book_slot((select agent from t), (select id from svc), ((select d from day) + time '10:00') at time zone 'UTC', null, 'Ann', '+111', null, null, 'whatsapp')->>'ok'), 'true', 'booking a free slot works');
select is((select count(*)::int from public.get_available_slots((select agent from t), (select id from svc), (select d from day), (select d from day))), 2, 'booked slot disappears');
select is((public.book_slot((select agent from t), (select id from svc), ((select d from day) + time '10:00') at time zone 'UTC', null, 'Bob', '+222', null, null, 'call')->>'reason'), 'slot_taken', 'double booking is refused');
select is((public.book_slot((select agent from t), (select id from svc), ((select d from day) + time '13:00') at time zone 'UTC', null, 'Cy', '+333', null, null, 'call')->>'reason'), 'slot_taken', 'outside availability is refused');
select is((select ref from public.bookings where customer_name = 'Ann'), 'B-1001', 'human ref assigned');

update public.booking_settings set capacity = 2 where agent_id = (select agent from t);
select is((public.book_slot((select agent from t), (select id from svc), ((select d from day) + time '10:00') at time zone 'UTC', null, 'Bob', '+222', null, null, 'call')->>'ok'), 'true', 'capacity 2 allows a second booking');
select is((public.book_slot((select agent from t), (select id from svc), ((select d from day) + time '10:00') at time zone 'UTC', null, 'Dee', '+444', null, null, 'call')->>'reason'), 'slot_taken', 'third booking at capacity 2 is refused');

select is((public.reschedule_booking((select id from public.bookings where customer_name = 'Ann'), ((select d from day) + time '11:00') at time zone 'UTC')->>'ok'), 'true', 'reschedule to a free slot');
update public.booking_settings set buffer_minutes = 30, capacity = 1 where agent_id = (select agent from t);
select is((select count(*)::int from public.get_available_slots((select agent from t), (select id from svc), (select d from day), (select d from day))), 0, 'buffer + capacity leave no room');

select * from finish();
rollback;

-- Phase 6: bookings (race-safe), orders (server-priced quotes), slot generation.

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  ref text not null,
  agent_id uuid not null references public.agents(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  service_id uuid references public.catalog_items(id) on delete set null,
  service_name text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'confirmed' check (status in ('pending','confirmed','cancelled','completed','no_show')),
  source text not null check (source in ('call','whatsapp','manual','playground','campaign')),
  campaign_id uuid,
  customer_name text,
  customer_phone text,
  address text,
  notes text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  unique (agent_id, ref)
);
alter table public.bookings enable row level security;
create index on public.bookings (agent_id, starts_at);
create trigger trg_bookings_updated before update on public.bookings for each row execute function public.touch_updated_at();

create table public.order_quotes (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  lines jsonb not null,
  subtotal_minor bigint not null,
  delivery_fee_minor bigint not null default 0,
  total_minor bigint not null,
  currency text not null,
  fulfillment text not null check (fulfillment in ('delivery','pickup')),
  address text,
  expires_at timestamptz not null default now() + interval '30 minutes',
  created_at timestamptz not null default now()
);
alter table public.order_quotes enable row level security;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null,
  agent_id uuid not null references public.agents(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  items jsonb not null,
  subtotal_minor bigint not null,
  delivery_fee_minor bigint not null default 0,
  total_minor bigint not null,
  currency text not null,
  fulfillment text not null check (fulfillment in ('delivery','pickup')),
  address text,
  payment_method text,
  customer_name text,
  customer_phone text,
  status text not null default 'new' check (status in ('new','confirmed','preparing','completed','cancelled')),
  source text not null check (source in ('call','whatsapp','manual','playground','campaign')),
  campaign_id uuid,
  notes text,
  is_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, ref)
);
alter table public.orders enable row level security;
create index on public.orders (workspace_id, created_at desc);
create trigger trg_orders_updated before update on public.orders for each row execute function public.touch_updated_at();

-- Short human refs: B-1042 / O-1042
create or replace function public.next_ref(p_agent uuid, p_prefix text)
returns text language sql security definer set search_path = public as $$
  select p_prefix || '-' || (1000 + coalesce((
    select max(nullif(regexp_replace(ref, '\D', '', 'g'), '')::int) - 1000 from (
      select ref from public.bookings where agent_id = p_agent and p_prefix = 'B'
      union all select ref from public.orders where agent_id = p_agent and p_prefix = 'O') r), 0) + 1)::text;
$$;

-- ── Slots ──
create or replace function public.get_available_slots(p_agent uuid, p_service uuid, p_from date, p_to date)
returns table (start_at timestamptz, end_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
  bs public.booking_settings;
  dur int;
  d date;
  w record;
  s timestamptz;
  win_end timestamptz;
  block interval;
  last_day date;
begin
  if auth.uid() is not null and not public.is_member(public.agent_workspace(p_agent)) then return; end if;
  select * into bs from public.booking_settings where agent_id = p_agent;
  if bs.agent_id is null then return; end if;
  select coalesce(duration_minutes, bs.default_duration_minutes) into dur from public.catalog_items where id = p_service and agent_id = p_agent;
  dur := coalesce(dur, bs.default_duration_minutes);
  block := make_interval(mins => dur + bs.buffer_minutes);
  last_day := least(p_to, (now() at time zone bs.timezone)::date + bs.max_days_ahead);

  d := greatest(p_from, (now() at time zone bs.timezone)::date);
  while d <= last_day loop
    for w in
      select e.start_time as st, e.end_time as et from public.availability_exceptions e
        where e.agent_id = p_agent and e.date = d and not e.closed and e.start_time is not null
      union all
      select r.start_time, r.end_time from public.availability_rules r
        where r.agent_id = p_agent and r.weekday = extract(dow from d)::int
          and not exists (select 1 from public.availability_exceptions x where x.agent_id = p_agent and x.date = d)
    loop
      s := (d + w.st) at time zone bs.timezone;
      win_end := (d + w.et) at time zone bs.timezone;
      while s + make_interval(mins => dur) <= win_end loop
        if s >= now() + make_interval(mins => bs.min_notice_minutes)
           and (select count(*) from public.bookings b
                where b.agent_id = p_agent and b.status in ('pending','confirmed')
                  and b.starts_at < s + block and b.ends_at + make_interval(mins => bs.buffer_minutes) > s) < bs.capacity then
          start_at := s; end_at := s + make_interval(mins => dur);
          return next;
        end if;
        s := s + make_interval(mins => bs.slot_interval_minutes);
      end loop;
    end loop;
    d := d + 1;
  end loop;
end $$;

-- Race-safe booking: serialise per agent, re-check the slot, insert.
create or replace function public.book_slot(
  p_agent uuid, p_service uuid, p_start timestamptz, p_contact uuid, p_name text, p_phone text,
  p_notes text, p_address text, p_source text, p_is_test boolean default false, p_force boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.agents; bs public.booking_settings; svc public.catalog_items; dur int; ok boolean; b public.bookings;
begin
  select * into a from public.agents where id = p_agent;
  if a.id is null then raise exception 'not_found'; end if;
  -- members may book manually; tools run as service role (auth.uid() is null)
  if auth.uid() is not null and not public.is_member(a.workspace_id) then raise exception 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtext('book:' || p_agent::text));
  select * into bs from public.booking_settings where agent_id = p_agent;
  select * into svc from public.catalog_items where id = p_service and agent_id = p_agent;
  dur := coalesce(svc.duration_minutes, bs.default_duration_minutes, 30);

  if not p_force then
    select exists (select 1 from public.get_available_slots(p_agent, p_service, (p_start at time zone bs.timezone)::date, (p_start at time zone bs.timezone)::date) g where g.start_at = p_start) into ok;
    if not ok then return jsonb_build_object('ok', false, 'reason', 'slot_taken'); end if;
  end if;

  insert into public.bookings (ref, agent_id, workspace_id, contact_id, service_id, service_name, starts_at, ends_at, status, source,
                               customer_name, customer_phone, address, notes, is_test)
  values (public.next_ref(p_agent, 'B'), p_agent, a.workspace_id, p_contact, svc.id, svc.name, p_start, p_start + make_interval(mins => dur),
          case when coalesce(bs.auto_confirm, true) then 'confirmed' else 'pending' end, p_source,
          nullif(trim(p_name), ''), p_phone, nullif(trim(p_address), ''), nullif(trim(p_notes), ''), p_is_test)
  returning * into b;
  return jsonb_build_object('ok', true, 'booking_id', b.id, 'ref', b.ref, 'status', b.status, 'starts_at', b.starts_at, 'ends_at', b.ends_at);
end $$;

-- Reschedule with the same lock + availability check (the booking's own slot is freed first).
create or replace function public.reschedule_booking(p_booking uuid, p_start timestamptz, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.bookings; bs public.booking_settings; ok boolean; dur interval;
begin
  select * into b from public.bookings where id = p_booking;
  if b.id is null then raise exception 'not_found'; end if;
  if auth.uid() is not null and not public.is_member(b.workspace_id) then raise exception 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtext('book:' || b.agent_id::text));
  select * into bs from public.booking_settings where agent_id = b.agent_id;
  dur := b.ends_at - b.starts_at;
  update public.bookings set status = 'cancelled' where id = b.id;           -- free its own slot for the check
  if not p_force then
    select exists (select 1 from public.get_available_slots(b.agent_id, b.service_id, (p_start at time zone bs.timezone)::date, (p_start at time zone bs.timezone)::date) g where g.start_at = p_start) into ok;
    if not ok then
      update public.bookings set status = b.status where id = b.id;
      return jsonb_build_object('ok', false, 'reason', 'slot_taken');
    end if;
  end if;
  update public.bookings set status = b.status, starts_at = p_start, ends_at = p_start + dur where id = b.id;
  return jsonb_build_object('ok', true, 'ref', b.ref, 'starts_at', p_start);
end $$;

revoke execute on function public.get_available_slots, public.next_ref from public, anon;
grant execute on function public.reschedule_booking to authenticated;
grant execute on function public.get_available_slots, public.book_slot to authenticated;

-- ── RLS ──
create policy "members read" on public.bookings for select using (public.is_member(workspace_id) or public.is_platform_admin());
create policy "members update" on public.bookings for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
grant update (status, notes, customer_name, address) on public.bookings to authenticated;
create policy "members read" on public.orders for select using (public.is_member(workspace_id) or public.is_platform_admin());
create policy "members update" on public.orders for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
grant update (status, notes) on public.orders to authenticated;
create policy "members read" on public.order_quotes for select using (public.is_member(public.agent_workspace(agent_id)));

do $$ begin
  begin execute 'alter publication supabase_realtime add table public.bookings, public.orders, public.leads'; exception when others then null; end;
end $$;

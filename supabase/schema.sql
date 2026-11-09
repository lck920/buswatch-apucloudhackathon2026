-- BusWatch database schema. Paste into Supabase -> SQL Editor -> Run.
-- Safe to re-run: drops and recreates the tables.
--
-- (Sunday has no Mosque shuttle, so it has no bus_schedule rows.)
-- SECURITY NOTE (demo level): the website uses the public "anon" key.
-- Anyone can READ the data tables; only the uploader (service role key) can write.
-- That's fine for simulated data. Before using real student data, require sign-in.

drop table if exists demand, timetable, bus_schedule, model_metrics, checkins cascade;   -- checkins: old table, removed

-- One row per 30-minute slot per stop per route (10,752 rows of simulated data)
create table demand (
  id                bigserial primary key,
  timestamp         timestamp not null,
  date              date not null,
  week              smallint not null,
  day_of_week       text not null,
  time_slot         text not null,          -- "HH:MM"
  stop              text not null,
  route             text not null,
  students_waiting  integer not null,       -- carried over + new arrivals
  new_arrivals      integer not null,       -- fresh demand, used by the What-If simulator
  buses_arrived     smallint not null,
  total_capacity    integer not null,       -- free seats offered in the slot
  boarded           integer not null,
  left_behind       integer not null,       -- still waiting after the slot (counted again each slot)
  missed_bus        integer not null,       -- left behind for the first time (each student once)
  avg_wait_minutes  real not null,
  is_rainy          smallint not null,
  is_exam_week      smallint not null,
  predicted_waiting real                    -- model's out-of-week prediction
);
create index demand_date_idx  on demand (date);
create index demand_route_idx on demand (route);
create index demand_stop_idx  on demand (stop);

create table timetable (
  class_id     text primary key,
  period       text not null,               -- regular | exam_week
  days         text not null,               -- e.g. "Mon/Wed"
  block        text not null,
  room         text not null,
  nearest_stop text not null,
  start_time   text not null,
  end_time     text not null,
  students     integer not null
);

create table bus_schedule (
  id                 bigserial primary key,
  service_day        text not null,           -- Mon - Fri | Saturday | Sunday
  route              text not null,
  trip               integer not null,
  stop               text not null,
  stop_order         smallint not null,
  arrival_time       text not null,
  capacity           smallint not null,
  free_seats_at_stop smallint not null
);
create index bus_schedule_route_idx on bus_schedule (route);
create index bus_schedule_stop_idx  on bus_schedule (stop);

-- The whole metrics.json as one JSON document
create table model_metrics (
  id         integer primary key,
  metrics    jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row Level Security on every table
alter table demand        enable row level security;
alter table timetable     enable row level security;
alter table bus_schedule  enable row level security;
alter table model_metrics enable row level security;

-- Public read of the (simulated) data tables. Writes only via the service role key.
create policy "public read demand"        on demand        for select using (true);
create policy "public read timetable"     on timetable     for select using (true);
create policy "public read bus_schedule"  on bus_schedule  for select using (true);
create policy "public read model_metrics" on model_metrics for select using (true);

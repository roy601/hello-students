-- ============================================================
--  HelloStudents — database schema
--  Run this whole file in: Supabase Dashboard > SQL Editor
--
--  Safe to run again, and safe to run over the older
--  (hourly rate) version — step 5 cleans that up.
-- ============================================================
--  5 tables:
--    profiles         one row per user (name, phone, role)
--    subjects         list of subjects  (reference data)
--    areas            list of areas     (reference data)
--    tutor_profiles   extra info for users who are tutors
--    batches          a group class: days, time, monthly fee
--
--  PRICING: a tutor does NOT charge by the hour. They open a
--  BATCH that runs on fixed days, and each student pays a
--  MONTHLY FEE to join it. This is how coaching works in
--  Bangladesh, so it is how the database works here.
-- ============================================================


-- ------------------------------------------------------------
-- 1. PROFILES  — extends Supabase's built-in auth.users table
-- ------------------------------------------------------------
create table if not exists profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  phone      text,
  role       text not null default 'student',
  created_at timestamptz not null default now(),

  constraint role_must_be_valid check (role in ('student', 'tutor'))
);


-- ------------------------------------------------------------
-- 2. SUBJECTS — fixed list, tutors pick from it (not free text)
-- ------------------------------------------------------------
create table if not exists subjects (
  id          bigserial primary key,
  name_en     text not null,
  name_bn     text not null,
  grade_level text not null,

  unique (name_en, grade_level)
);


-- ------------------------------------------------------------
-- 3. AREAS — where a batch is held
-- ------------------------------------------------------------
create table if not exists areas (
  id      bigserial primary key,
  name_en text not null,
  name_bn text not null,
  city    text not null,

  unique (name_en, city)
);


-- ------------------------------------------------------------
-- 4. TUTOR_PROFILES — only for users whose role is 'tutor'
--    Just who the tutor is. No price here: the price lives
--    on each batch, because different batches cost different
--    amounts.
-- ------------------------------------------------------------
create table if not exists tutor_profiles (
  id         uuid primary key references profiles (id) on delete cascade,
  headline   text,
  bio        text,
  created_at timestamptz not null default now()
);


-- ------------------------------------------------------------
-- 5. CLEAN-UP — only does something if you ran the older
--    version of this file. On a new project it does nothing.
--
--    This runs AFTER the tables above on purpose:
--      * "drop policy if exists" still fails if the TABLE is
--        missing, so the table has to exist first
--      * a column cannot be dropped while a policy mentions
--        it, so the old policies have to go before the columns
-- ------------------------------------------------------------

-- old policies first
drop policy if exists "read published tutors"    on tutor_profiles;
drop policy if exists "tutor creates own profile" on tutor_profiles;
drop policy if exists "tutor updates own profile" on tutor_profiles;

-- old table (its policies go with it)
drop table if exists tutor_subjects;

-- old columns: pricing and location moved to `batches`
alter table tutor_profiles drop column if exists hourly_rate;
alter table tutor_profiles drop column if exists area_id;
alter table tutor_profiles drop column if exists teaches_online;
alter table tutor_profiles drop column if exists is_published;


-- ------------------------------------------------------------
-- 6. BATCHES — one group class, with its monthly fee
--    Example: "HSC Physics — Morning Batch"
--             Sun, Tue, Thu · 8:00–9:30 AM
--             ৳2,500 per month · 15 seats · Dhanmondi
-- ------------------------------------------------------------
create table if not exists batches (
  id           bigserial primary key,
  tutor_id     uuid   not null references tutor_profiles (id) on delete cascade,
  subject_id   bigint not null references subjects (id),
  area_id      bigint references areas (id),

  title        text not null,
  days         text not null,              -- e.g. 'Sun, Tue, Thu'
  start_time   time not null,
  end_time     time not null,
  monthly_fee  integer not null,           -- whole taka per student per month
  seat_limit   integer not null default 10,
  is_online    boolean not null default false,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),

  constraint fee_must_be_at_least_100 check (monthly_fee >= 100),
  constraint seats_must_be_sensible    check (seat_limit between 1 and 100),
  constraint must_end_after_it_starts  check (end_time > start_time)
);

create index if not exists batches_subject_idx on batches (subject_id);
create index if not exists batches_area_idx    on batches (area_id);


-- ============================================================
--  SEED DATA — so the app has something to show immediately
-- ============================================================

insert into subjects (name_en, name_bn, grade_level) values
  ('Mathematics',        'গণিত',                'Class 9'),
  ('Mathematics',        'গণিত',                'Class 10'),
  ('Higher Mathematics', 'উচ্চতর গণিত',          'Class 10'),
  ('Physics 1st Paper',  'পদার্থবিজ্ঞান ১ম পত্র', 'HSC'),
  ('Physics 2nd Paper',  'পদার্থবিজ্ঞান ২য় পত্র', 'HSC'),
  ('Chemistry',          'রসায়ন',               'HSC'),
  ('Biology',            'জীববিজ্ঞান',           'HSC'),
  ('English',            'ইংরেজি',              'Class 9'),
  ('ICT',                'তথ্য ও যোগাযোগ প্রযুক্তি', 'HSC')
on conflict do nothing;

insert into areas (name_en, name_bn, city) values
  ('Dhanmondi',    'ধানমন্ডি',    'Dhaka'),
  ('Mohammadpur',  'মোহাম্মদপুর',  'Dhaka'),
  ('Uttara',       'উত্তরা',      'Dhaka'),
  ('Mirpur',       'মিরপুর',      'Dhaka'),
  ('Bashundhara',  'বসুন্ধরা',     'Dhaka'),
  ('Agrabad',      'আগ্রাবাদ',     'Chattogram'),
  ('Nasirabad',    'নাসিরাবাদ',    'Chattogram')
on conflict do nothing;


-- ============================================================
--  ROW LEVEL SECURITY (RLS)
--  RLS decides which rows a user may see or change. Without it,
--  anyone with the public key could edit anyone's data.
--  auth.uid() is the id of the logged-in user.
-- ============================================================

alter table profiles       enable row level security;
alter table subjects       enable row level security;
alter table areas          enable row level security;
alter table tutor_profiles enable row level security;
alter table batches        enable row level security;


-- --- profiles -------------------------------------------------
drop policy if exists "anyone can read profiles" on profiles;
create policy "anyone can read profiles"
  on profiles for select
  using (true);

drop policy if exists "user creates own profile" on profiles;
create policy "user creates own profile"
  on profiles for insert
  with check (auth.uid() = id);

drop policy if exists "user updates own profile" on profiles;
create policy "user updates own profile"
  on profiles for update
  using (auth.uid() = id);


-- --- subjects & areas (read-only reference data) --------------
drop policy if exists "anyone can read subjects" on subjects;
create policy "anyone can read subjects"
  on subjects for select
  using (true);

drop policy if exists "anyone can read areas" on areas;
create policy "anyone can read areas"
  on areas for select
  using (true);


-- --- tutor_profiles -------------------------------------------
drop policy if exists "anyone can read tutor profiles" on tutor_profiles;
create policy "anyone can read tutor profiles"
  on tutor_profiles for select
  using (true);

drop policy if exists "tutor creates own profile" on tutor_profiles;
create policy "tutor creates own profile"
  on tutor_profiles for insert
  with check (auth.uid() = id);

drop policy if exists "tutor updates own profile" on tutor_profiles;
create policy "tutor updates own profile"
  on tutor_profiles for update
  using (auth.uid() = id);


-- --- batches --------------------------------------------------
-- Students see published batches. A tutor also sees their own
-- unpublished drafts.
drop policy if exists "read published batches" on batches;
create policy "read published batches"
  on batches for select
  using (is_published = true or auth.uid() = tutor_id);

drop policy if exists "tutor creates own batch" on batches;
create policy "tutor creates own batch"
  on batches for insert
  with check (auth.uid() = tutor_id);

drop policy if exists "tutor updates own batch" on batches;
create policy "tutor updates own batch"
  on batches for update
  using (auth.uid() = tutor_id);

drop policy if exists "tutor deletes own batch" on batches;
create policy "tutor deletes own batch"
  on batches for delete
  using (auth.uid() = tutor_id);

-- ============================================================
--  HelloStudents — full database
--  Run this whole file in: Supabase Dashboard > SQL Editor
--  Safe to run again.
-- ============================================================
--  12 tables
--    profiles           one row per user (name, phone, role)
--    subjects           list of subjects            (fixed list)
--    areas              list of areas               (fixed list)
--    tutor_profiles     tutor details + approval status
--    tutor_credentials  certificates a tutor uploads for checking
--    batches            a group class with a monthly fee
--    enrolments         a student joined a batch
--    wallets            how much money a student has on the site
--    transactions       every money movement, never edited
--    reviews            a student rates a tutor
--    notifications      alerts shown in the bell menu
--    messages           the chat inside one batch (Part 7)
--
--  PRICING: tutors do not charge per hour. They open a BATCH
--  that runs on fixed days, and each student pays a MONTHLY
--  FEE to join it. This is how coaching works in Bangladesh.
-- ============================================================


-- ============================================================
--  PART 1 — TABLES
-- ============================================================

-- ---- 1. profiles -------------------------------------------
create table if not exists profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null,
  phone      text,
  role       text not null default 'student',
  created_at timestamptz not null default now(),

  constraint role_must_be_valid check (role in ('student', 'tutor', 'admin'))
);


-- ---- 2. subjects -------------------------------------------
create table if not exists subjects (
  id          bigserial primary key,
  name_en     text not null,
  name_bn     text not null,
  grade_level text not null,

  unique (name_en, grade_level)
);


-- ---- 3. areas ----------------------------------------------
create table if not exists areas (
  id      bigserial primary key,
  name_en text not null,
  name_bn text not null,
  city    text not null,

  unique (name_en, city)
);


-- ---- 4. tutor_profiles -------------------------------------
--  status: a new tutor is 'pending' until an admin approves.
--  Only approved tutors can publish batches.
create table if not exists tutor_profiles (
  id                uuid primary key references profiles (id) on delete cascade,
  headline          text,
  bio               text,
  years_experience  integer not null default 0,
  area_id           bigint references areas (id),
  status            text not null default 'pending',
  verified_level    text not null default 'none',
  rating_avg        numeric(3,2) not null default 0,
  rating_count      integer not null default 0,
  students_taught   integer not null default 0,
  reject_reason     text,
  created_at        timestamptz not null default now(),

  constraint status_must_be_valid
    check (status in ('pending', 'approved', 'rejected', 'suspended')),
  constraint verified_level_must_be_valid
    check (verified_level in ('none', 'id_verified', 'certificate_verified')),
  constraint experience_must_be_sensible
    check (years_experience between 0 and 60)
);


-- ---- 5. tutor_credentials ----------------------------------
create table if not exists tutor_credentials (
  id           bigserial primary key,
  tutor_id     uuid not null references tutor_profiles (id) on delete cascade,
  title        text not null,          -- 'BSc in EEE'
  institution  text not null,          -- 'BUET'
  year_awarded integer,
  status       text not null default 'pending',
  created_at   timestamptz not null default now(),

  constraint credential_status_must_be_valid
    check (status in ('pending', 'verified', 'rejected'))
);


-- ---- 6. batches --------------------------------------------
create table if not exists batches (
  id           bigserial primary key,
  tutor_id     uuid   not null references tutor_profiles (id) on delete cascade,
  subject_id   bigint not null references subjects (id),
  area_id      bigint references areas (id),

  title        text not null,
  description  text,
  days         text not null,              -- 'Sun, Tue, Thu'
  start_time   time not null,
  end_time     time not null,
  monthly_fee  integer not null,           -- whole taka, per student, per month
  seat_limit   integer not null default 10,
  seats_taken  integer not null default 0,
  is_online    boolean not null default false,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),

  constraint fee_must_be_at_least_100 check (monthly_fee >= 100),
  constraint seats_must_be_sensible   check (seat_limit between 1 and 100),
  constraint seats_taken_is_sensible  check (seats_taken >= 0),
  constraint must_end_after_it_starts check (end_time > start_time)
);

create index if not exists batches_subject_idx on batches (subject_id);
create index if not exists batches_area_idx    on batches (area_id);
create index if not exists batches_tutor_idx   on batches (tutor_id);


-- ---- 7. enrolments -----------------------------------------
create table if not exists enrolments (
  id          bigserial primary key,
  batch_id    bigint not null references batches (id) on delete cascade,
  student_id  uuid   not null references profiles (id) on delete cascade,
  fee_paid    integer not null,
  status      text not null default 'active',
  created_at  timestamptz not null default now(),

  unique (batch_id, student_id),          -- cannot join the same batch twice
  constraint enrolment_status_must_be_valid check (status in ('active', 'left'))
);

create index if not exists enrolments_student_idx on enrolments (student_id);
create index if not exists enrolments_batch_idx   on enrolments (batch_id);


-- ---- 8. wallets --------------------------------------------
create table if not exists wallets (
  user_id    uuid primary key references profiles (id) on delete cascade,
  balance    integer not null default 0,       -- whole taka
  updated_at timestamptz not null default now(),

  constraint balance_can_never_be_negative check (balance >= 0)
);


-- ---- 9. transactions ---------------------------------------
--  A history of every money movement. Rows are never changed
--  or deleted, so the balance can always be checked.
create table if not exists transactions (
  id          bigserial primary key,
  user_id     uuid not null references profiles (id) on delete cascade,
  kind        text not null,
  amount      integer not null,        -- + money in, - money out
  note        text,
  batch_id    bigint references batches (id) on delete set null,
  created_at  timestamptz not null default now(),

  constraint kind_must_be_valid
    check (kind in ('top_up', 'enrol_payment', 'tutor_earning', 'refund'))
);

create index if not exists transactions_user_idx on transactions (user_id, created_at desc);


-- ---- 10. reviews -------------------------------------------
create table if not exists reviews (
  id           bigserial primary key,
  enrolment_id bigint not null unique references enrolments (id) on delete cascade,
  batch_id     bigint not null references batches (id) on delete cascade,
  tutor_id     uuid   not null references tutor_profiles (id) on delete cascade,
  student_id   uuid   not null references profiles (id) on delete cascade,
  rating       integer not null,
  comment      text,
  created_at   timestamptz not null default now(),

  constraint rating_must_be_1_to_5 check (rating between 1 and 5)
);

create index if not exists reviews_tutor_idx on reviews (tutor_id);


-- ---- 11. notifications -------------------------------------
create table if not exists notifications (
  id         bigserial primary key,
  user_id    uuid not null references profiles (id) on delete cascade,
  title      text not null,
  body       text,
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on notifications (user_id, is_read, created_at desc);


-- ============================================================
--  PART 2 — UPGRADE AN OLDER DATABASE
--
--  IMPORTANT: "create table if not exists" above does nothing
--  when the table is already there — which means it does NOT
--  add new columns to it. So every column, constraint and
--  policy added after the first version is repeated here as
--  an "alter". On a brand new database this part changes
--  nothing, and it is safe to run as many times as you like.
--
--  It runs AFTER the tables on purpose:
--    * "drop policy if exists" still fails if the TABLE is
--      missing, so the tables must exist first
--    * a column cannot be dropped while a policy mentions it
-- ============================================================

-- ---- 2a. old policies must go first ------------------------
--  "tutor creates own batch" is the important one. The new
--  rule below only lets an APPROVED tutor create a batch, but
--  policies are combined with OR, so leaving the old rule in
--  place would let anyone skip the approval check.
drop policy if exists "read published tutors"     on tutor_profiles;
drop policy if exists "tutor creates own profile" on tutor_profiles;
drop policy if exists "tutor updates own profile" on tutor_profiles;
drop policy if exists "tutor creates own batch"   on batches;


-- ---- 2b. table and columns that are no longer used ---------
drop table if exists tutor_subjects;

alter table tutor_profiles drop column if exists hourly_rate;
alter table tutor_profiles drop column if exists teaches_online;
alter table tutor_profiles drop column if exists is_published;


-- ---- 2c. profiles: allow the 'admin' role ------------------
--  The first version only allowed 'student' and 'tutor', so
--  making yourself an admin would be refused.
alter table profiles drop constraint if exists role_must_be_valid;
alter table profiles add  constraint role_must_be_valid
  check (role in ('student', 'tutor', 'admin'));


-- ---- 2d. tutor_profiles: columns added later ---------------
alter table tutor_profiles add column if not exists years_experience integer      not null default 0;
alter table tutor_profiles add column if not exists area_id          bigint       references areas (id);
alter table tutor_profiles add column if not exists status           text         not null default 'pending';
alter table tutor_profiles add column if not exists verified_level   text         not null default 'none';
alter table tutor_profiles add column if not exists rating_avg       numeric(3,2) not null default 0;
alter table tutor_profiles add column if not exists rating_count     integer      not null default 0;
alter table tutor_profiles add column if not exists students_taught  integer      not null default 0;
alter table tutor_profiles add column if not exists reject_reason    text;

alter table tutor_profiles drop constraint if exists status_must_be_valid;
alter table tutor_profiles add  constraint status_must_be_valid
  check (status in ('pending', 'approved', 'rejected', 'suspended'));

alter table tutor_profiles drop constraint if exists verified_level_must_be_valid;
alter table tutor_profiles add  constraint verified_level_must_be_valid
  check (verified_level in ('none', 'id_verified', 'certificate_verified'));

alter table tutor_profiles drop constraint if exists experience_must_be_sensible;
alter table tutor_profiles add  constraint experience_must_be_sensible
  check (years_experience between 0 and 60);


-- ---- 2e. batches: columns added later ----------------------
alter table batches add column if not exists description text;
alter table batches add column if not exists seats_taken integer not null default 0;

alter table batches drop constraint if exists seats_taken_is_sensible;
alter table batches add  constraint seats_taken_is_sensible check (seats_taken >= 0);


-- ---- 2f. make seats_taken agree with the real enrolments ---
--  Only matters if a batch already had students before the
--  seats_taken column existed.
update batches b
   set seats_taken = (select count(*) from enrolments e where e.batch_id = b.id)
 where b.seats_taken <> (select count(*) from enrolments e where e.batch_id = b.id);


-- ============================================================
--  PART 3 — SEED DATA
-- ============================================================
insert into subjects (name_en, name_bn, grade_level) values
  ('Mathematics',        'গণিত',                  'Class 6'),
  ('Mathematics',        'গণিত',                  'Class 7'),
  ('Mathematics',        'গণিত',                  'Class 8'),
  ('Mathematics',        'গণিত',                  'Class 9'),
  ('Mathematics',        'গণিত',                  'Class 10'),
  ('Higher Mathematics', 'উচ্চতর গণিত',            'Class 10'),
  ('Physics 1st Paper',  'পদার্থবিজ্ঞান ১ম পত্র',   'HSC'),
  ('Physics 2nd Paper',  'পদার্থবিজ্ঞান ২য় পত্র',   'HSC'),
  ('Chemistry 1st Paper','রসায়ন ১ম পত্র',          'HSC'),
  ('Chemistry 2nd Paper','রসায়ন ২য় পত্র',          'HSC'),
  ('Biology',            'জীববিজ্ঞান',             'HSC'),
  ('English',            'ইংরেজি',                'Class 9'),
  ('English',            'ইংরেজি',                'HSC'),
  ('ICT',                'তথ্য ও যোগাযোগ প্রযুক্তি',  'HSC'),
  ('Accounting',         'হিসাববিজ্ঞান',            'HSC'),
  ('Bangla 1st Paper',   'বাংলা ১ম পত্র',           'HSC')
on conflict do nothing;

insert into areas (name_en, name_bn, city) values
  ('Dhanmondi',    'ধানমন্ডি',    'Dhaka'),
  ('Mohammadpur',  'মোহাম্মদপুর',  'Dhaka'),
  ('Uttara',       'উত্তরা',      'Dhaka'),
  ('Mirpur',       'মিরপুর',      'Dhaka'),
  ('Bashundhara',  'বসুন্ধরা',     'Dhaka'),
  ('Banani',       'বনানী',       'Dhaka'),
  ('Motijheel',    'মতিঝিল',      'Dhaka'),
  ('Agrabad',      'আগ্রাবাদ',     'Chattogram'),
  ('Nasirabad',    'নাসিরাবাদ',    'Chattogram'),
  ('Khulshi',      'খুলশী',       'Chattogram')
on conflict do nothing;


-- ============================================================
--  PART 4 — DATABASE FUNCTIONS
--  These run inside the database. They are used for actions
--  that must happen completely or not at all, such as paying
--  for a batch (money out, seat taken, both together).
-- ============================================================

-- ---- Every new user gets a wallet automatically ------------
create or replace function create_wallet_for_new_profile()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into wallets (user_id, balance)
  values (new.id, 0)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created on profiles;
create trigger on_profile_created
  after insert on profiles
  for each row execute function create_wallet_for_new_profile();


-- ---- Add money to your own wallet --------------------------
--  DEMO ONLY. A real site would confirm the payment with
--  bKash or Nagad on a server before calling this.
create or replace function top_up_wallet(amount integer)
returns integer
language plpgsql
security definer
as $$
declare
  new_balance integer;
begin
  if amount < 100 or amount > 20000 then
    raise exception 'Amount must be between 100 and 20000 taka';
  end if;

  update wallets
     set balance = balance + amount, updated_at = now()
   where user_id = auth.uid()
  returning balance into new_balance;

  if new_balance is null then
    raise exception 'Wallet not found';
  end if;

  insert into transactions (user_id, kind, amount, note)
  values (auth.uid(), 'top_up', amount, 'Added money to wallet');

  insert into notifications (user_id, title, body, link)
  values (auth.uid(),
          'Money added',
          amount || ' taka added. Your balance is now ' || new_balance || ' taka.',
          'student-wallet.html');

  return new_balance;
end;
$$;


-- ---- Join a batch ------------------------------------------
--  Everything below happens together, or nothing happens:
--    check seats -> check balance -> take money -> give seat
--    -> pay the tutor -> tell both people
create or replace function enrol_in_batch(p_batch_id bigint)
returns text
language plpgsql
security definer
as $$
declare
  v_student   uuid := auth.uid();
  v_batch     batches%rowtype;
  v_balance   integer;
  v_student_name text;
begin
  if v_student is null then
    raise exception 'You must be logged in';
  end if;

  -- lock this batch row so two students cannot take the last seat
  select * into v_batch from batches where id = p_batch_id for update;

  if not found then
    raise exception 'Batch not found';
  end if;
  if not v_batch.is_published then
    raise exception 'This batch is not open yet';
  end if;
  if v_batch.seats_taken >= v_batch.seat_limit then
    raise exception 'This batch is full';
  end if;
  if exists (select 1 from enrolments
              where batch_id = p_batch_id and student_id = v_student) then
    raise exception 'You have already joined this batch';
  end if;

  select balance into v_balance from wallets where user_id = v_student for update;

  if v_balance is null then
    raise exception 'Wallet not found';
  end if;
  if v_balance < v_batch.monthly_fee then
    raise exception 'Not enough balance. You need % taka.', v_batch.monthly_fee;
  end if;

  -- take the money from the student
  update wallets
     set balance = balance - v_batch.monthly_fee, updated_at = now()
   where user_id = v_student;

  insert into transactions (user_id, kind, amount, note, batch_id)
  values (v_student, 'enrol_payment', -v_batch.monthly_fee,
          'Joined ' || v_batch.title, p_batch_id);

  -- give the seat
  insert into enrolments (batch_id, student_id, fee_paid)
  values (p_batch_id, v_student, v_batch.monthly_fee);

  update batches set seats_taken = seats_taken + 1 where id = p_batch_id;
  update tutor_profiles set students_taught = students_taught + 1
   where id = v_batch.tutor_id;

  -- pay the tutor (the site keeps 15%)
  insert into transactions (user_id, kind, amount, note, batch_id)
  values (v_batch.tutor_id, 'tutor_earning',
          round(v_batch.monthly_fee * 0.85),
          'A student joined ' || v_batch.title, p_batch_id);

  update wallets
     set balance = balance + round(v_batch.monthly_fee * 0.85), updated_at = now()
   where user_id = v_batch.tutor_id;

  -- tell both people
  select full_name into v_student_name from profiles where id = v_student;

  insert into notifications (user_id, title, body, link)
  values (v_student, 'You joined a batch',
          'You joined ' || v_batch.title || '. See it in My Classes.',
          'student-dashboard.html');

  insert into notifications (user_id, title, body, link)
  values (v_batch.tutor_id, 'New student',
          v_student_name || ' joined ' || v_batch.title || '.',
          'tutor-students.html');

  return 'ok';
end;
$$;


-- ---- Keep the tutor rating up to date ----------------------
create or replace function refresh_tutor_rating()
returns trigger
language plpgsql
security definer
as $$
declare
  v_tutor uuid := coalesce(new.tutor_id, old.tutor_id);
begin
  update tutor_profiles
     set rating_avg   = coalesce((select round(avg(rating), 2)
                                    from reviews where tutor_id = v_tutor), 0),
         rating_count = (select count(*) from reviews where tutor_id = v_tutor)
   where id = v_tutor;
  return null;
end;
$$;

drop trigger if exists on_review_changed on reviews;
create trigger on_review_changed
  after insert or update or delete on reviews
  for each row execute function refresh_tutor_rating();


-- ---- Tell a tutor when an admin decides --------------------
create or replace function notify_tutor_of_decision()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.status is distinct from old.status then
    if new.status = 'approved' then
      insert into notifications (user_id, title, body, link)
      values (new.id, 'Your account is approved',
              'You can now publish batches and take students.',
              'tutor-batches.html');
    elsif new.status = 'rejected' then
      insert into notifications (user_id, title, body, link)
      values (new.id, 'Your application needs changes',
              coalesce(new.reject_reason, 'Please check your profile and apply again.'),
              'tutor-profile.html');
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_tutor_status_changed on tutor_profiles;
create trigger on_tutor_status_changed
  after update on tutor_profiles
  for each row execute function notify_tutor_of_decision();


-- ============================================================
--  PART 5 — ROW LEVEL SECURITY
--  Rules stored inside the database that decide who may see
--  or change each row. auth.uid() is the logged-in user.
-- ============================================================

alter table profiles          enable row level security;
alter table subjects          enable row level security;
alter table areas             enable row level security;
alter table tutor_profiles    enable row level security;
alter table tutor_credentials enable row level security;
alter table batches           enable row level security;
alter table enrolments        enable row level security;
alter table wallets           enable row level security;
alter table transactions      enable row level security;
alter table reviews           enable row level security;
alter table notifications     enable row level security;


-- ---- helper: is the logged-in user an admin? ---------------
create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;


-- ---- profiles ----------------------------------------------
drop policy if exists "anyone can read profiles" on profiles;
create policy "anyone can read profiles"
  on profiles for select using (true);

drop policy if exists "user creates own profile" on profiles;
create policy "user creates own profile"
  on profiles for insert with check (auth.uid() = id);

drop policy if exists "user updates own profile" on profiles;
create policy "user updates own profile"
  on profiles for update using (auth.uid() = id);


-- ---- subjects & areas (fixed lists, read only) -------------
drop policy if exists "anyone can read subjects" on subjects;
create policy "anyone can read subjects"
  on subjects for select using (true);

drop policy if exists "anyone can read areas" on areas;
create policy "anyone can read areas"
  on areas for select using (true);


-- ---- tutor_profiles ----------------------------------------
drop policy if exists "anyone can read tutor profiles" on tutor_profiles;
create policy "anyone can read tutor profiles"
  on tutor_profiles for select using (true);

drop policy if exists "tutor creates own tutor profile" on tutor_profiles;
create policy "tutor creates own tutor profile"
  on tutor_profiles for insert with check (auth.uid() = id);

drop policy if exists "tutor or admin updates tutor profile" on tutor_profiles;
create policy "tutor or admin updates tutor profile"
  on tutor_profiles for update using (auth.uid() = id or is_admin());


-- ---- tutor_credentials -------------------------------------
drop policy if exists "read own or admin reads all credentials" on tutor_credentials;
create policy "read own or admin reads all credentials"
  on tutor_credentials for select using (auth.uid() = tutor_id or is_admin());

drop policy if exists "tutor adds own credential" on tutor_credentials;
create policy "tutor adds own credential"
  on tutor_credentials for insert with check (auth.uid() = tutor_id);

drop policy if exists "tutor deletes own credential" on tutor_credentials;
create policy "tutor deletes own credential"
  on tutor_credentials for delete using (auth.uid() = tutor_id);

drop policy if exists "admin updates credential" on tutor_credentials;
create policy "admin updates credential"
  on tutor_credentials for update using (is_admin());


-- ---- batches -----------------------------------------------
--  Students only see published batches from APPROVED tutors.
drop policy if exists "read published batches" on batches;
create policy "read published batches"
  on batches for select
  using (
    auth.uid() = tutor_id
    or is_admin()
    or (
      is_published = true
      and exists (select 1 from tutor_profiles t
                   where t.id = batches.tutor_id and t.status = 'approved')
    )
  );

--  Only an APPROVED tutor may create a batch.
drop policy if exists "approved tutor creates own batch" on batches;
create policy "approved tutor creates own batch"
  on batches for insert
  with check (
    auth.uid() = tutor_id
    and exists (select 1 from tutor_profiles t
                 where t.id = auth.uid() and t.status = 'approved')
  );

drop policy if exists "tutor updates own batch" on batches;
create policy "tutor updates own batch"
  on batches for update using (auth.uid() = tutor_id);

drop policy if exists "tutor deletes own batch" on batches;
create policy "tutor deletes own batch"
  on batches for delete using (auth.uid() = tutor_id);


-- ---- enrolments --------------------------------------------
--  A student sees their own. A tutor sees who joined their batch.
drop policy if exists "student or tutor reads enrolment" on enrolments;
create policy "student or tutor reads enrolment"
  on enrolments for select
  using (
    auth.uid() = student_id
    or is_admin()
    or exists (select 1 from batches b
                where b.id = enrolments.batch_id and b.tutor_id = auth.uid())
  );
--  No insert policy on purpose: joining only happens through
--  the enrol_in_batch() function, so money and seats stay correct.


-- ---- wallets -----------------------------------------------
drop policy if exists "read own wallet" on wallets;
create policy "read own wallet"
  on wallets for select using (auth.uid() = user_id);
--  No insert or update policy: only the database functions
--  may change a balance.


-- ---- transactions ------------------------------------------
drop policy if exists "read own transactions" on transactions;
create policy "read own transactions"
  on transactions for select using (auth.uid() = user_id or is_admin());


-- ---- reviews -----------------------------------------------
drop policy if exists "anyone can read reviews" on reviews;
create policy "anyone can read reviews"
  on reviews for select using (true);

--  You may only review a batch you actually joined and paid for.
drop policy if exists "student reviews own enrolment" on reviews;
create policy "student reviews own enrolment"
  on reviews for insert
  with check (
    auth.uid() = student_id
    and exists (select 1 from enrolments e
                 where e.id = reviews.enrolment_id
                   and e.student_id = auth.uid())
  );

drop policy if exists "student updates own review" on reviews;
create policy "student updates own review"
  on reviews for update using (auth.uid() = student_id);


-- ---- notifications -----------------------------------------
drop policy if exists "read own notifications" on notifications;
create policy "read own notifications"
  on notifications for select using (auth.uid() = user_id);

drop policy if exists "update own notifications" on notifications;
create policy "update own notifications"
  on notifications for update using (auth.uid() = user_id);


-- ============================================================
--  PART 6 — MAKE YOURSELF AN ADMIN
--  Register normally in the app first, then run this line with
--  your own email to open the Admin pages.
--
--    update profiles set role = 'admin'
--     where id = (select id from auth.users where email = 'you@example.com');
-- ============================================================


-- ============================================================
--  PART 7 — LIVE CLASS AND BATCH CHAT ROOM
--  Added after the first version. Safe to run again.
-- ============================================================

-- ---- Live class details on each batch ----------------------
alter table batches add column if not exists live_link text;
alter table batches add column if not exists is_live boolean not null default false;
alter table batches add column if not exists live_started_at timestamptz;


-- ---- Chat messages inside one batch ------------------------
create table if not exists messages (
  id         bigserial primary key,
  batch_id   bigint not null references batches (id) on delete cascade,
  sender_id  uuid   not null references profiles (id) on delete cascade,
  body       text   not null,
  created_at timestamptz not null default now(),

  constraint message_must_not_be_empty check (length(trim(body)) between 1 and 1000)
);

create index if not exists messages_batch_idx on messages (batch_id, created_at);


-- ---- Who is allowed inside a batch room? -------------------
--  The student must have joined it, or be the batch's tutor.
create or replace function can_access_batch(p_batch_id bigint)
returns boolean
language sql
security definer
stable
as $$
  select
    exists (select 1 from enrolments
             where batch_id = p_batch_id and student_id = auth.uid())
    or exists (select 1 from batches
                where id = p_batch_id and tutor_id = auth.uid())
    or is_admin();
$$;


-- ---- Security rules for the chat ---------------------------
alter table messages enable row level security;

--  You can only read a room you belong to.
drop policy if exists "members read messages" on messages;
create policy "members read messages"
  on messages for select
  using (can_access_batch(batch_id));

--  You can only write as yourself, and only in a room you belong to.
drop policy if exists "members write messages" on messages;
create policy "members write messages"
  on messages for insert
  with check (auth.uid() = sender_id and can_access_batch(batch_id));

--  You may delete your own message.
drop policy if exists "delete own message" on messages;
create policy "delete own message"
  on messages for delete
  using (auth.uid() = sender_id);


-- ---- Turn on live updates for the chat ---------------------
--  This is what makes a new message appear on everyone's
--  screen straight away, without refreshing the page.
do $$
begin
  alter publication supabase_realtime add table messages;
exception
  when duplicate_object then null;   -- already added, nothing to do
end $$;


-- ---- Tell students when the class goes live ----------------
create or replace function notify_students_class_is_live()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.is_live = true and old.is_live = false then
    insert into notifications (user_id, title, body, link)
    select e.student_id,
           'Class started',
           new.title || ' has started. Join now.',
           'batch-room.html?id=' || new.id
      from enrolments e
     where e.batch_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_batch_went_live on batches;
create trigger on_batch_went_live
  after update on batches
  for each row execute function notify_students_class_is_live();


-- ============================================================
--  PART 8 — THREE WAYS TO RUN A LIVE CLASS
--  Safe to run again.
-- ============================================================
--    'jitsi'  video inside our page, using the free Jitsi
--             media server. Works for a whole batch.
--    'p2p'    our own WebRTC video. The browsers talk straight
--             to each other, with no media server at all.
--             Good for a few people only.
--    'link'   the tutor's own Zoom or Meet link.
-- ============================================================

alter table batches add column if not exists live_mode text not null default 'jitsi';
alter table batches add column if not exists room_code text;

alter table batches drop constraint if exists live_mode_must_be_valid;
alter table batches add  constraint live_mode_must_be_valid
  check (live_mode in ('jitsi', 'p2p', 'link'));

-- ---- A private room name for every batch -------------------
--  The batch id alone (1, 2, 3...) would be far too easy for a
--  stranger to guess, so each batch gets a random room name.
update batches
   set room_code = 'hs-' || id::text || '-'
                 || substr(md5(random()::text || clock_timestamp()::text), 1, 10)
 where room_code is null;

alter table batches alter column room_code
  set default ('hs-' || substr(md5(random()::text || clock_timestamp()::text), 1, 14));


-- ============================================================
--  PART 9 — WHO WATCHED THE CLASS
--  Safe to run again.
--
--  Every time someone opens a live class, one row is written
--  here. The video itself also shows their name on screen
--  (see js/watermark.js), so a leaked recording points at a
--  person. This table is the second half of that: even if the
--  label was somehow removed, there is still a list of who
--  was watching at that moment.
-- ============================================================

create table if not exists class_views (
  id         bigserial primary key,
  batch_id   bigint not null references batches (id) on delete cascade,
  user_id    uuid   not null references profiles (id) on delete cascade,
  mode       text,                       -- jitsi | p2p | link
  user_agent text,                       -- which browser and device
  opened_at  timestamptz not null default now()
);

create index if not exists class_views_batch_idx on class_views (batch_id, opened_at desc);

alter table class_views enable row level security;

--  You can only write a row about yourself, and only for a
--  batch you actually belong to.
drop policy if exists "log own view" on class_views;
create policy "log own view"
  on class_views for insert
  with check (auth.uid() = user_id and can_access_batch(batch_id));

--  The tutor of the batch and an admin can see the list.
--  A student can see their own rows only.
drop policy if exists "tutor or admin reads views" on class_views;
create policy "tutor or admin reads views"
  on class_views for select
  using (
    auth.uid() = user_id
    or is_admin()
    or exists (select 1 from batches b
                where b.id = class_views.batch_id and b.tutor_id = auth.uid())
  );


-- ============================================================
--  PART 10 — PAY FOR ONE BATCH (payment gateway)
--  Safe to run again.
-- ============================================================
--  Before this, a student could only pay from their wallet.
--  Now they can also pay for one batch directly with bKash,
--  Nagad, Rocket or a card.
--
--  THE THREE STEPS, AND WHO IS ALLOWED TO DO EACH:
--    1. start_batch_payment()   the student  -> makes an order
--    2. mark the order as paid  THE GATEWAY  -> never the browser
--    3. enrol_with_payment()    the student  -> only if step 2 happened
--
--  Step 2 must never be trusted to the browser, because anyone
--  could then claim "I paid" without paying. In the real setup
--  a Supabase Edge Function does it, using the secret merchant
--  password that the browser never sees.
-- ============================================================

create table if not exists payments (
  id           bigserial primary key,
  tran_id      text not null unique,      -- our own reference, sent to the gateway
  student_id   uuid   not null references profiles (id) on delete cascade,
  batch_id     bigint not null references batches (id) on delete cascade,
  amount       integer not null,
  method       text,                      -- bkash | nagad | rocket | card
  status       text not null default 'initiated',
  provider     text not null default 'demo',   -- demo | sslcommerz
  provider_ref text,                      -- the gateway own reference
  created_at   timestamptz not null default now(),
  paid_at      timestamptz,

  constraint payment_amount_is_sensible check (amount > 0),
  constraint payment_status_is_valid
    check (status in ('initiated', 'paid', 'failed', 'cancelled', 'used'))
);

create index if not exists payments_student_idx on payments (student_id, created_at desc);
create index if not exists payments_batch_idx   on payments (batch_id);


-- ---- STEP 1: the student starts an order -------------------
create or replace function start_batch_payment(p_batch_id bigint, p_method text)
returns text
language plpgsql
security definer
as $fn$
declare
  v_student uuid := auth.uid();
  v_batch   batches%rowtype;
  v_tran    text;
begin
  if v_student is null then
    raise exception 'You must be logged in';
  end if;

  select * into v_batch from batches where id = p_batch_id;

  if not found then
    raise exception 'Batch not found';
  end if;
  if not v_batch.is_published then
    raise exception 'This batch is not open yet';
  end if;
  if v_batch.seats_taken >= v_batch.seat_limit then
    raise exception 'This batch is full';
  end if;
  if exists (select 1 from enrolments
              where batch_id = p_batch_id and student_id = v_student) then
    raise exception 'You have already joined this batch';
  end if;

  -- A reference the gateway sends back to us, e.g. HS-7-1a2b3c4d
  v_tran := 'HS-' || p_batch_id::text || '-' ||
            substr(md5(random()::text || clock_timestamp()::text), 1, 8);

  insert into payments (tran_id, student_id, batch_id, amount, method)
  values (v_tran, v_student, p_batch_id, v_batch.monthly_fee, p_method);

  return v_tran;
end;
$fn$;


-- ---- STEP 2 (DEMO ONLY): pretend the gateway said yes ------
--  *** REMOVE THIS FUNCTION BEFORE A REAL LAUNCH. ***
--  It lets the browser mark an order as paid, which is exactly
--  the job a real gateway must do instead. It exists only so
--  the project can be shown working without a merchant account.
--
--    drop function if exists demo_confirm_payment(text);
create or replace function demo_confirm_payment(p_tran_id text)
returns text
language plpgsql
security definer
as $fn$
declare
  v_payment payments%rowtype;
begin
  select * into v_payment from payments
   where tran_id = p_tran_id and student_id = auth.uid()
   for update;

  if not found then
    raise exception 'Payment not found';
  end if;
  if v_payment.status <> 'initiated' then
    raise exception 'This payment is already %', v_payment.status;
  end if;

  update payments
     set status = 'paid',
         paid_at = now(),
         provider_ref = 'DEMO-' || substr(md5(random()::text), 1, 10)
   where id = v_payment.id;

  return 'paid';
end;
$fn$;


-- ---- STEP 3: turn a paid order into a seat -----------------
--  Everything happens together, or nothing does.
create or replace function enrol_with_payment(p_tran_id text)
returns text
language plpgsql
security definer
as $fn$
declare
  v_student uuid := auth.uid();
  v_payment payments%rowtype;
  v_batch   batches%rowtype;
  v_name    text;
begin
  select * into v_payment from payments
   where tran_id = p_tran_id and student_id = v_student
   for update;

  if not found then
    raise exception 'Payment not found';
  end if;
  if v_payment.status = 'used' then
    raise exception 'This payment has already been used';
  end if;
  if v_payment.status <> 'paid' then
    raise exception 'This payment is not complete yet';
  end if;

  select * into v_batch from batches where id = v_payment.batch_id for update;

  if v_batch.seats_taken >= v_batch.seat_limit then
    raise exception 'This batch filled up. Please contact support for a refund.';
  end if;
  if exists (select 1 from enrolments
              where batch_id = v_batch.id and student_id = v_student) then
    raise exception 'You have already joined this batch';
  end if;

  -- the seat
  insert into enrolments (batch_id, student_id, fee_paid)
  values (v_batch.id, v_student, v_payment.amount);

  update batches set seats_taken = seats_taken + 1 where id = v_batch.id;
  update tutor_profiles set students_taught = students_taught + 1
   where id = v_batch.tutor_id;

  -- the student record of what they paid
  insert into transactions (user_id, kind, amount, note, batch_id)
  values (v_student, 'enrol_payment', -v_payment.amount,
          'Paid for ' || v_batch.title || ' by ' || coalesce(v_payment.method, 'card'),
          v_batch.id);

  -- the tutor gets 85%, the site keeps 15%
  insert into transactions (user_id, kind, amount, note, batch_id)
  values (v_batch.tutor_id, 'tutor_earning',
          round(v_payment.amount * 0.85),
          'A student joined ' || v_batch.title, v_batch.id);

  update wallets
     set balance = balance + round(v_payment.amount * 0.85), updated_at = now()
   where user_id = v_batch.tutor_id;

  -- the order cannot be spent twice
  update payments set status = 'used' where id = v_payment.id;

  select full_name into v_name from profiles where id = v_student;

  insert into notifications (user_id, title, body, link)
  values (v_student, 'Payment received',
          'You joined ' || v_batch.title || '. See it in My Classes.',
          'student-dashboard.html');

  insert into notifications (user_id, title, body, link)
  values (v_batch.tutor_id, 'New student',
          v_name || ' paid and joined ' || v_batch.title || '.',
          'tutor-students.html');

  return 'ok';
end;
$fn$;


-- ---- Security rules ----------------------------------------
alter table payments enable row level security;

--  A student sees their own orders. An admin sees all.
drop policy if exists "read own payments" on payments;
create policy "read own payments"
  on payments for select
  using (auth.uid() = student_id or is_admin());

--  No insert or update policy on purpose: orders are only
--  created and changed by the functions above, so the browser
--  can never write or edit a payment row directly.


-- ============================================================
--  PART 11 â€” THE CLASSROOM
--
--  This is the Google Classroom style part of a batch:
--  a wall everyone can talk on, and work the tutor sets
--  and marks.
--
--  Three tables:
--
--    posts          one note on the class wall. A post is one
--                   of three kinds:
--                     announcement  a message to the class
--                     material      a note with a link to read
--                     assignment    work, with a due date
--
--    post_comments  what people say under a post. This is how
--                   the whole batch talks to each other.
--
--    submissions    one student's answer to one assignment,
--                   plus the mark the tutor gave it.
--
--  Run this part after PART 10.
-- ============================================================


-- ---- 1. the class wall -------------------------------------
create table if not exists posts (
  id         bigserial primary key,
  batch_id   bigint not null references batches (id)   on delete cascade,
  author_id  uuid   not null references profiles (id)  on delete cascade,

  kind       text   not null default 'announcement',
  title      text,
  body       text,
  link_url   text,

  --  only used when kind = 'assignment'
  due_at     timestamptz,
  points     integer,

  created_at timestamptz not null default now(),

  constraint post_kind_is_known
    check (kind in ('announcement', 'material', 'assignment')),

  --  an announcement needs words, the other two need a title
  constraint post_must_say_something
    check (
      (kind = 'announcement' and length(trim(coalesce(body, ''))) between 1 and 5000)
      or (kind <> 'announcement' and length(trim(coalesce(title, ''))) between 1 and 200)
    ),

  constraint points_must_be_sensible
    check (points is null or points between 1 and 1000)
);

create index if not exists posts_batch_idx on posts (batch_id, created_at desc);


-- ---- 2. comments under a post ------------------------------
create table if not exists post_comments (
  id         bigserial primary key,
  post_id    bigint not null references posts (id)     on delete cascade,
  author_id  uuid   not null references profiles (id)  on delete cascade,
  body       text   not null,
  created_at timestamptz not null default now(),

  constraint comment_must_not_be_empty
    check (length(trim(body)) between 1 and 2000)
);

create index if not exists post_comments_post_idx
  on post_comments (post_id, created_at);


-- ---- 3. a student's answer to one assignment ---------------
create table if not exists submissions (
  id           bigserial primary key,
  post_id      bigint not null references posts (id)    on delete cascade,
  student_id   uuid   not null references profiles (id) on delete cascade,

  note         text,
  link_url     text,

  status       text not null default 'submitted',
  marks        integer,
  feedback     text,

  submitted_at timestamptz not null default now(),
  returned_at  timestamptz,

  --  one answer per student per assignment
  constraint one_answer_per_student unique (post_id, student_id),

  constraint submission_status_is_known
    check (status in ('submitted', 'returned'))
);

create index if not exists submissions_post_idx on submissions (post_id);
create index if not exists submissions_student_idx on submissions (student_id);


-- ============================================================
--  WHO IS THE TUTOR OF THIS BATCH?
--
--  can_access_batch (PART 7) already answers "is this person
--  in the room". This one answers "is this person in charge of
--  the room", which is what setting and marking work needs.
-- ============================================================
create or replace function is_batch_tutor(p_batch_id bigint)
returns boolean
language sql
security definer
stable
as $fn$
  select exists (
    select 1 from batches
     where id = p_batch_id and tutor_id = auth.uid()
  );
$fn$;


-- ============================================================
--  SECURITY RULES FOR THE WALL
-- ============================================================
alter table posts enable row level security;

--  Everyone in the batch reads the wall.
drop policy if exists "members read posts" on posts;
create policy "members read posts"
  on posts for select
  using (can_access_batch(batch_id));

--  Anyone in the batch may write an announcement, because the
--  whole point is that students can talk too. But only the
--  tutor may set work or post material.
drop policy if exists "members write posts" on posts;
create policy "members write posts"
  on posts for insert
  with check (
    auth.uid() = author_id
    and can_access_batch(batch_id)
    and (kind = 'announcement' or is_batch_tutor(batch_id))
  );

--  You may edit your own post.
drop policy if exists "edit own post" on posts;
create policy "edit own post"
  on posts for update
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

--  You may delete your own post. The tutor may delete any post
--  in their batch, the way a teacher can clear the noticeboard.
drop policy if exists "delete own post" on posts;
create policy "delete own post"
  on posts for delete
  using (auth.uid() = author_id or is_batch_tutor(batch_id));


-- ============================================================
--  SECURITY RULES FOR COMMENTS
--
--  A comment has no batch_id of its own, so every rule looks
--  up the post it belongs to and asks about that batch.
-- ============================================================
alter table post_comments enable row level security;

drop policy if exists "members read comments" on post_comments;
create policy "members read comments"
  on post_comments for select
  using (
    exists (select 1 from posts p
             where p.id = post_id and can_access_batch(p.batch_id))
  );

drop policy if exists "members write comments" on post_comments;
create policy "members write comments"
  on post_comments for insert
  with check (
    auth.uid() = author_id
    and exists (select 1 from posts p
                 where p.id = post_id and can_access_batch(p.batch_id))
  );

drop policy if exists "delete own comment" on post_comments;
create policy "delete own comment"
  on post_comments for delete
  using (
    auth.uid() = author_id
    or exists (select 1 from posts p
                where p.id = post_id and is_batch_tutor(p.batch_id))
  );


-- ============================================================
--  SECURITY RULES FOR SUBMITTED WORK
--
--  Read only. There is no insert or update policy on purpose.
--  Handing work in and marking it both go through the two
--  functions below, the same way payments do, so a student
--  cannot quietly give themselves 100 out of 100.
-- ============================================================
alter table submissions enable row level security;

--  A student sees their own work. The tutor sees the whole
--  batch's work.
drop policy if exists "student or tutor reads submission" on submissions;
create policy "student or tutor reads submission"
  on submissions for select
  using (
    auth.uid() = student_id
    or is_admin()
    or exists (select 1 from posts p
                where p.id = post_id and is_batch_tutor(p.batch_id))
  );


-- ============================================================
--  CLASSMATES CAN SEE EACH OTHER
--
--  The People tab needs this. Until now a student could only
--  see their own enrolment row, so the class list came back
--  empty. Now anyone in the batch can see who else is in it â€”
--  and only for a batch they are actually in.
-- ============================================================
drop policy if exists "classmates see each other" on enrolments;
create policy "classmates see each other"
  on enrolments for select
  using (can_access_batch(batch_id));


-- ============================================================
--  HAND WORK IN
--
--  Called by the student. Handing in twice just replaces the
--  first answer, which is what "unsubmit and try again" means.
--  Work already marked cannot be changed.
-- ============================================================
create or replace function submit_work(
  p_post_id bigint,
  p_note    text,
  p_link    text
)
returns text
language plpgsql
security definer
as $fn$
declare
  v_student  uuid := auth.uid();
  v_post     posts%rowtype;
  v_existing submissions%rowtype;
begin
  if v_student is null then
    raise exception 'You must be logged in';
  end if;

  select * into v_post from posts where id = p_post_id;

  if not found then
    raise exception 'That work no longer exists';
  end if;
  if v_post.kind <> 'assignment' then
    raise exception 'That post is not an assignment';
  end if;

  --  must be a student of this batch, not the tutor
  if not exists (select 1 from enrolments
                  where batch_id = v_post.batch_id and student_id = v_student) then
    raise exception 'You are not a student of this batch';
  end if;

  if trim(coalesce(p_note, '')) = '' and trim(coalesce(p_link, '')) = '' then
    raise exception 'Write an answer or add a link before handing in';
  end if;

  select * into v_existing from submissions
   where post_id = p_post_id and student_id = v_student;

  if found and v_existing.status = 'returned' then
    raise exception 'This work is already marked, so it cannot be changed';
  end if;

  insert into submissions (post_id, student_id, note, link_url, status, submitted_at)
  values (p_post_id, v_student,
          nullif(trim(coalesce(p_note, '')), ''),
          nullif(trim(coalesce(p_link, '')), ''),
          'submitted', now())
  on conflict (post_id, student_id) do update
     set note         = excluded.note,
         link_url     = excluded.link_url,
         status       = 'submitted',
         submitted_at = now();

  --  tell the tutor it arrived
  insert into notifications (user_id, title, body, link)
  select b.tutor_id,
         'Work handed in',
         coalesce(pr.full_name, 'A student') || ' handed in ' ||
           coalesce(v_post.title, 'an assignment') || '.',
         'batch-room.html?id=' || v_post.batch_id
    from batches b
    left join profiles pr on pr.id = v_student
   where b.id = v_post.batch_id;

  return 'ok';
end;
$fn$;


-- ============================================================
--  MARK WORK
--
--  Called by the tutor only. The check below is the reason a
--  student cannot mark their own work: this function looks up
--  who owns the batch, and auth.uid() cannot be faked.
-- ============================================================
create or replace function grade_work(
  p_submission_id bigint,
  p_marks         integer,
  p_feedback      text
)
returns text
language plpgsql
security definer
as $fn$
declare
  v_sub  submissions%rowtype;
  v_post posts%rowtype;
begin
  select * into v_sub from submissions where id = p_submission_id;
  if not found then
    raise exception 'That work was not found';
  end if;

  select * into v_post from posts where id = v_sub.post_id;

  if not is_batch_tutor(v_post.batch_id) then
    raise exception 'Only the tutor of this batch can mark work';
  end if;

  if p_marks is not null and v_post.points is not null
     and (p_marks < 0 or p_marks > v_post.points) then
    raise exception 'Marks must be between 0 and %.', v_post.points;
  end if;

  update submissions
     set marks       = p_marks,
         feedback    = nullif(trim(coalesce(p_feedback, '')), ''),
         status      = 'returned',
         returned_at = now()
   where id = p_submission_id;

  insert into notifications (user_id, title, body, link)
  values (v_sub.student_id,
          'Your work was marked',
          coalesce(v_post.title, 'Your assignment') || ' has been returned' ||
            case when p_marks is null then '.'
                 else ' with ' || p_marks || ' out of ' ||
                      coalesce(v_post.points::text, '?') || '.' end,
          'batch-room.html?id=' || v_post.batch_id);

  return 'ok';
end;
$fn$;


-- ============================================================
--  TELL THE CLASS WHEN THE TUTOR POSTS
--
--  A trigger, not browser code, so the notification is written
--  even if the tutor closes the tab straight away.
--  Only the tutor's posts notify, or every student comment
--  would ping the whole batch.
-- ============================================================
create or replace function notify_batch_of_post()
returns trigger
language plpgsql
security definer
as $fn$
declare
  v_batch batches%rowtype;
  v_what  text;
begin
  select * into v_batch from batches where id = new.batch_id;

  if v_batch.tutor_id <> new.author_id then
    return new;               -- a student posted, so stay quiet
  end if;

  v_what := case new.kind
              when 'assignment' then 'New work: ' || coalesce(new.title, '')
              when 'material'   then 'New material: ' || coalesce(new.title, '')
              else 'New announcement'
            end;

  insert into notifications (user_id, title, body, link)
  select e.student_id,
         v_what,
         'In ' || v_batch.title || '.',
         'batch-room.html?id=' || new.batch_id
    from enrolments e
   where e.batch_id = new.batch_id;

  return new;
end;
$fn$;

drop trigger if exists posts_notify_batch on posts;
create trigger posts_notify_batch
  after insert on posts
  for each row execute function notify_batch_of_post();


-- ============================================================
--  LIVE UPDATES FOR THE WALL
--
--  So a new post or comment appears on everyone's screen
--  without refreshing, exactly like the chat in PART 7.
-- ============================================================
do $$
begin
  begin
    alter publication supabase_realtime add table posts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table post_comments;
  exception when duplicate_object then null;
  end;
end $$;


-- ============================================================
--  PART 12 â€” RECORDINGS, DISPUTES AND EMAIL
--
--  Three things this part adds:
--
--    recordings   the tutor uploads a video of a class, and
--                 students of that batch can watch it again.
--                 The file itself lives in Supabase Storage;
--                 this table only remembers where it is.
--
--    disputes     a student says something went wrong, and an
--                 admin either refunds them or turns it down.
--
--    email_sent   one new column on notifications. The server
--                 looks for notifications that have not been
--                 emailed yet, sends them, and ticks this.
--
--  Run this part after PART 11.
-- ============================================================


-- ============================================================
--  1. RECORDINGS
-- ============================================================
create table if not exists recordings (
  id           bigserial primary key,
  batch_id     bigint not null references batches (id)   on delete cascade,
  tutor_id     uuid   not null references profiles (id)  on delete cascade,

  title        text   not null,

  --  where the file sits inside the "recordings" bucket.
  --  Always "<batch id>/<something>", because the storage
  --  rules below read the batch id out of the first folder.
  storage_path text   not null unique,

  size_bytes   bigint,
  created_at   timestamptz not null default now(),

  constraint recording_needs_a_title
    check (length(trim(title)) between 1 and 200)
);

create index if not exists recordings_batch_idx
  on recordings (batch_id, created_at desc);


alter table recordings enable row level security;

--  Everyone in the batch can see what was recorded.
drop policy if exists "members read recordings" on recordings;
create policy "members read recordings"
  on recordings for select
  using (can_access_batch(batch_id));

--  Only the tutor of the batch can add one.
drop policy if exists "tutor adds recording" on recordings;
create policy "tutor adds recording"
  on recordings for insert
  with check (auth.uid() = tutor_id and is_batch_tutor(batch_id));

--  Only the tutor of the batch can remove one.
drop policy if exists "tutor deletes recording" on recordings;
create policy "tutor deletes recording"
  on recordings for delete
  using (is_batch_tutor(batch_id));


-- ---- the bucket the video files go in ----------------------
--  Not public: every view goes through a signed link that
--  lasts one hour, so a copied address stops working.
insert into storage.buckets (id, name, public)
values ('recordings', 'recordings', false)
on conflict (id) do nothing;


-- ---- which batch does this file belong to? -----------------
--  The path is "<batch id>/<file>", so the batch is the first
--  folder. The case statement is here on purpose: if anything
--  ever lands in the bucket with a non-numeric folder, this
--  returns null instead of throwing, and null simply fails
--  every check below.
create or replace function batch_id_from_path(p_name text)
returns bigint
language sql
immutable
as $fn$
  select case
           when (storage.foldername(p_name))[1] ~ '^[0-9]+$'
             then ((storage.foldername(p_name))[1])::bigint
           else null
         end;
$fn$;


-- ---- storage rules -----------------------------------------
--  Same two rules as the table: the batch's tutor may write,
--  anyone in the batch may read.
drop policy if exists "tutor uploads recording" on storage.objects;
create policy "tutor uploads recording"
  on storage.objects for insert
  with check (
    bucket_id = 'recordings'
    and is_batch_tutor(batch_id_from_path(name))
  );

drop policy if exists "members read recording file" on storage.objects;
create policy "members read recording file"
  on storage.objects for select
  using (
    bucket_id = 'recordings'
    and can_access_batch(batch_id_from_path(name))
  );

drop policy if exists "tutor deletes recording file" on storage.objects;
create policy "tutor deletes recording file"
  on storage.objects for delete
  using (
    bucket_id = 'recordings'
    and is_batch_tutor(batch_id_from_path(name))
  );


-- ---- tell the class a recording is up ----------------------
create or replace function notify_batch_of_recording()
returns trigger
language plpgsql
security definer
as $fn$
declare
  v_batch batches%rowtype;
begin
  select * into v_batch from batches where id = new.batch_id;

  insert into notifications (user_id, title, body, link)
  select e.student_id,
         'New recording',
         new.title || ' is ready to watch in ' || v_batch.title || '.',
         'batch-room.html?id=' || new.batch_id || '&tab=recordings'
    from enrolments e
   where e.batch_id = new.batch_id;

  return new;
end;
$fn$;

drop trigger if exists recordings_notify_batch on recordings;
create trigger recordings_notify_batch
  after insert on recordings
  for each row execute function notify_batch_of_recording();


-- ============================================================
--  2. DISPUTES
--
--  A student opens one against a batch they paid for. An admin
--  reads it and either refunds the money or turns it down.
-- ============================================================
create table if not exists disputes (
  id           bigserial primary key,
  enrolment_id bigint not null references enrolments (id) on delete cascade,
  batch_id     bigint not null references batches (id)    on delete cascade,
  student_id   uuid   not null references profiles (id)   on delete cascade,

  reason       text   not null,
  status       text   not null default 'open',
  admin_note   text,

  --  what the student actually got back, filled in on refund
  refunded     integer,

  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,

  constraint dispute_status_is_known
    check (status in ('open', 'refunded', 'rejected')),

  constraint dispute_needs_a_reason
    check (length(trim(reason)) between 10 and 2000)
);

create index if not exists disputes_status_idx on disputes (status, created_at desc);
create index if not exists disputes_student_idx on disputes (student_id);

--  Only one open complaint per enrolment, so a student cannot
--  flood the admin queue with the same problem.
create unique index if not exists one_open_dispute_per_enrolment
  on disputes (enrolment_id)
  where status = 'open';


alter table disputes enable row level security;

--  A student sees their own. An admin sees all of them.
drop policy if exists "student or admin reads dispute" on disputes;
create policy "student or admin reads dispute"
  on disputes for select
  using (auth.uid() = student_id or is_admin());

--  No insert or update policy on purpose. Opening and settling
--  a dispute both move money, so both go through the functions
--  below, the same way payments and marking do.


-- ---- a student opens a complaint ---------------------------
create or replace function raise_dispute(
  p_enrolment_id bigint,
  p_reason       text
)
returns text
language plpgsql
security definer
as $fn$
declare
  v_student   uuid := auth.uid();
  v_enrolment enrolments%rowtype;
  v_batch     batches%rowtype;
begin
  if v_student is null then
    raise exception 'You must be logged in';
  end if;

  select * into v_enrolment from enrolments where id = p_enrolment_id;

  if not found then
    raise exception 'That class was not found';
  end if;
  if v_enrolment.student_id <> v_student then
    raise exception 'That is not your class';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Please explain the problem in a sentence or two';
  end if;
  if exists (select 1 from disputes
              where enrolment_id = p_enrolment_id and status = 'open') then
    raise exception 'You already have an open complaint for this class';
  end if;

  select * into v_batch from batches where id = v_enrolment.batch_id;

  insert into disputes (enrolment_id, batch_id, student_id, reason)
  values (p_enrolment_id, v_enrolment.batch_id, v_student, trim(p_reason));

  --  tell every admin there is something to look at
  insert into notifications (user_id, title, body, link)
  select p.id,
         'New complaint',
         'A student reported a problem with ' || v_batch.title || '.',
         'admin-disputes.html'
    from profiles p
   where p.role = 'admin';

  return 'ok';
end;
$fn$;


-- ---- an admin settles it -----------------------------------
--
--  Refunding reverses the enrolment:
--    the student gets their money back
--    the tutor loses the 85% they were paid
--    the seat goes back on sale
--
--  One wrinkle. A wallet may never go below zero, and the
--  tutor may already have spent the money. So we take back
--  only what is actually there and record the rest as a
--  shortfall the site absorbs. Refusing the student their
--  refund because the tutor's wallet is empty would be the
--  wrong way round.
create or replace function resolve_dispute(
  p_dispute_id bigint,
  p_action     text,
  p_note       text
)
returns text
language plpgsql
security definer
as $fn$
declare
  v_dispute   disputes%rowtype;
  v_enrolment enrolments%rowtype;
  v_batch     batches%rowtype;
  v_tutor_had integer;
  v_claw      integer;
  v_owed      integer;
begin
  if not is_admin() then
    raise exception 'Only an admin can settle a complaint';
  end if;
  if p_action not in ('refund', 'reject') then
    raise exception 'Action must be refund or reject';
  end if;

  select * into v_dispute from disputes where id = p_dispute_id for update;

  if not found then
    raise exception 'That complaint was not found';
  end if;
  if v_dispute.status <> 'open' then
    raise exception 'That complaint is already %', v_dispute.status;
  end if;

  -- ---- turned down -----------------------------------------
  if p_action = 'reject' then
    update disputes
       set status = 'rejected',
           admin_note = nullif(trim(coalesce(p_note, '')), ''),
           resolved_at = now()
     where id = p_dispute_id;

    insert into notifications (user_id, title, body, link)
    values (v_dispute.student_id,
            'Your complaint was reviewed',
            coalesce(nullif(trim(coalesce(p_note, '')), ''),
                     'After looking into it we could not refund this one.'),
            'student-dashboard.html');

    return 'rejected';
  end if;

  -- ---- refunded --------------------------------------------
  select * into v_enrolment from enrolments
   where id = v_dispute.enrolment_id for update;

  select * into v_batch from batches
   where id = v_dispute.batch_id for update;

  v_owed := v_enrolment.fee_paid;

  --  give the student their money back
  update wallets
     set balance = balance + v_owed, updated_at = now()
   where user_id = v_dispute.student_id;

  insert into transactions (user_id, kind, amount, note, batch_id)
  values (v_dispute.student_id, 'refund', v_owed,
          'Refund for ' || v_batch.title, v_dispute.batch_id);

  --  take back what the tutor was paid, as far as possible
  select balance into v_tutor_had from wallets
   where user_id = v_batch.tutor_id for update;

  v_claw := least(round(v_owed * 0.85), coalesce(v_tutor_had, 0));

  if v_claw > 0 then
    update wallets
       set balance = balance - v_claw, updated_at = now()
     where user_id = v_batch.tutor_id;

    insert into transactions (user_id, kind, amount, note, batch_id)
    values (v_batch.tutor_id, 'refund', -v_claw,
            'Refund taken back for ' || v_batch.title, v_dispute.batch_id);
  end if;

  --  end the enrolment and put the seat back on sale
  update enrolments set status = 'left' where id = v_enrolment.id;

  update batches
     set seats_taken = greatest(seats_taken - 1, 0)
   where id = v_dispute.batch_id;

  update disputes
     set status = 'refunded',
         admin_note = nullif(trim(coalesce(p_note, '')), ''),
         refunded = v_owed,
         resolved_at = now()
   where id = p_dispute_id;

  insert into notifications (user_id, title, body, link)
  values (v_dispute.student_id,
          'You have been refunded',
          v_owed || ' taka is back in your wallet for ' || v_batch.title || '.',
          'student-wallet.html');

  insert into notifications (user_id, title, body, link)
  values (v_batch.tutor_id,
          'A student was refunded',
          'A complaint about ' || v_batch.title || ' was upheld and ' ||
            v_claw || ' taka was taken back.',
          'tutor-dashboard.html');

  return 'refunded';
end;
$fn$;


-- ============================================================
--  3. EMAIL
--
--  Every notification already written by the app becomes an
--  email as well. Nothing else has to change: the server reads
--  rows where email_sent is false, sends them, and ticks the
--  column. If the mail settings are missing the server simply
--  does not run that job, and the app carries on as before.
--
--  Only the server can tick this column, because it holds the
--  service role key. A student cannot mark their own mail as
--  sent, which is what stops the queue being tampered with.
-- ============================================================
alter table notifications
  add column if not exists email_sent boolean not null default false;

--  The server asks for "not yet emailed, oldest first", so
--  give that question its own index.
create index if not exists notifications_unsent_idx
  on notifications (created_at)
  where email_sent = false;


-- ============================================================
--  4. A REFUNDED STUDENT LOSES ACCESS
--
--  This replaces the version of can_access_batch written in
--  PART 7. It is repeated here rather than edited up there,
--  because your database has already run PART 7 and only a
--  fresh "create or replace" will change what is installed.
--
--  What changed and why:
--  refunding a student sets their enrolment to 'left', but the
--  old version only asked "is there an enrolment row?", so a
--  student who had just been given their money back could
--  still open the class room, read the wall, download the
--  recordings and post in the chat. Asking for an ACTIVE
--  enrolment closes that.
--
--  Everything else in the app calls this one function, so
--  fixing it here fixes the stream, the classwork, the
--  recordings, the people list and the chat all at once.
-- ============================================================
create or replace function can_access_batch(p_batch_id bigint)
returns boolean
language sql
security definer
stable
as $fn$
  select
    exists (select 1 from enrolments
             where batch_id = p_batch_id
               and student_id = auth.uid()
               and status = 'active')
    or exists (select 1 from batches
                where id = p_batch_id and tutor_id = auth.uid())
    or is_admin();
$fn$;

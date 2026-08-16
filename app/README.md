# HelloStudents — the application

A working tutor marketplace for Bangladesh, built with plain HTML, CSS and
JavaScript on top of a Supabase (PostgreSQL) database.

**14 pages · 20 JavaScript files · 12 database tables · 27 security rules**

---

## What is built

| # | Area | Where |
|---|---|---|
| 1 | **Accounts** — register, log in, log out, three roles | `register.js`, `login.js`, `session.js` |
| 2 | **Tutor onboarding** — profile, experience, certificates, approval status | `tutor-profile.js` |
| 3 | **Batches** — open, publish, unpublish, delete | `tutor-batches.js` |
| 4 | **Search** — filter by subject, area, fee, class type; sort | `browse.js` |
| 5 | **Batch page** — full details, tutor profile, reviews, join button | `batch.js` |
| 6 | **Wallet** — add money, balance, full payment history | `student-wallet.js` |
| 7 | **Joining a batch** — seat check, payment, tutor paid, all in one step | `enrol_in_batch()` in `schema.sql` |
| 8 | **Reviews** — rate a tutor after joining; average updates itself | `student-dashboard.js` |
| 9 | **Notifications** — bell menu with unread count | `session.js` |
| 10 | **Tutor dashboard** — earnings, students, batches, rating | `tutor-dashboard.js` |
| 11 | **Student list** — who joined which batch | `tutor-students.js` |
| 12 | **Admin approvals** — approve or reject tutors, check certificates | `admin-tutors.js` |
| 13 | **Admin overview** — money, people, batches | `admin-dashboard.js` |
| 14 | **Class chat room** — live messages inside one batch | `batch-room.js` |
| 15 | **Live class — group** — real video inside the page, whole batch | `jitsi.js` |
| 16 | **Live class — peer to peer** — our own WebRTC, no media server | `webrtc.js` |

### What is *not* built, and why

| Missing | Reason |
|---|---|
| Real bKash / Nagad charging | Needs a merchant account and a paid gateway. The wallet, ledger and tutor payouts are all real — only the moment of charging is simulated. |
| SMS reminders | Needs a paid BTRC-approved SMS gateway. Notifications are in-app instead. |
| A media server we own | Copying one video to 15 people needs a server farm. We use Jitsi's free one for group classes, and skip the server completely in peer-to-peer mode. |
| Recording the class | Needs a paid video service such as Cloudflare Stream. |
| Withdrawing money to a real bKash account | Same reason as the first row. The tutor's balance is tracked correctly. |

These are documented in `../Requirements/` but are not coded.

---

## Setup

### 1. Create a Supabase project
[supabase.com](https://supabase.com) → new project (free).

### 2. Build the database
**SQL Editor** → paste all of [`db/schema.sql`](db/schema.sql) → **Run**.

This creates 12 tables, 8 database functions, 4 triggers, 27 security rules,
and inserts 16 subjects and 10 areas. It is safe to run again.

### 3. Turn off email confirmation
**Authentication → Sign In / Providers → Email** → turn **Confirm email** OFF.
This lets a new user be logged in right after registering.

### 4. Add your keys
**Project Settings → API** → copy into [`js/config.js`](js/config.js).

### 5. Run
The app uses `import`, which needs a web address, so a small server is required:

```bash
cd app
python -m http.server 5500
```

Open <http://localhost:5500>.

### 6. Make yourself an admin
Register normally, then run this once in the SQL Editor:

```sql
update profiles set role = 'admin'
 where id = (select id from auth.users where email = 'you@example.com');
```

---

## Try the whole thing in 9 steps

1. Register as a **Tutor**. You land on your profile with a "Waiting for approval" banner.
2. Fill in the headline, about text, experience and area. Add a certificate.
3. Make a second account and turn it into an **admin** (step 6 above). Open
   **Tutor approvals**, mark the certificate as checked, and **Approve** the tutor.
4. Log back in as the tutor. The banner turns green. Go to **My batches** and
   open one — pick days, time, fee `2500`, seats `15`, publish.
5. Register a third account as a **Student**. Go to **Wallet** and add ৳3,000.
6. **Find a batch** → open your batch → **Join this batch**. The fee leaves your
   wallet, the seat count goes up, and the tutor is paid instantly.
7. **My classes** → **Rate tutor** → give 5 stars. The tutor's average updates.
8. Log in as the tutor and as the admin to see the money appear on both dashboards.
9. **Class room:** as the tutor, open **My batches → Class room**, press
   **Use a free room**, then **Start the class**. As the student (a second
   browser or a private window), the bell shows "Class started" and the class
   room now offers **Join**. Type in the chat from both sides — messages appear
   on the other screen instantly.

---

## The class room (`batch-room.html`)

Every batch has its own private room. Only students who **joined and paid** for
that batch, plus the batch's own tutor, can open it. The database checks this
too, in `can_access_batch()`, so editing the JavaScript does not get anyone in.

### 1. Live class — three modes

The tutor picks how to run the class. All three are built.

| Mode | How the video travels | Good for | Cost |
|---|---|---|---|
| **Group class** (default) | Everyone sends video once to the free **Jitsi** media server, which copies it to everyone else. Runs **inside our page**. | A whole batch, 15+ students | Free, no account |
| **Peer to peer** | **Our own WebRTC code.** The browsers send video straight to each other. **No media server anywhere.** | 2 to 4 people | Free |
| **My own link** | The tutor's Zoom / Meet / Teams link, shown only to students who paid | Any size | Their own account |

#### Why three, and not just one

A browser cannot send video to 15 people by itself — that is not a limit of this
project, it is how the web works. Either a **media server** copies the stream
(Jitsi, Zoom, Meet), or the browsers talk **directly** to each other and every
person carries every other person's video (peer to peer).

So "group class" and "peer to peer" are not two versions of the same thing. They
are the two real answers, and the app has both.

#### How the peer-to-peer mode works (`js/webrtc.js`)

This is written from scratch. Two browsers cannot find each other on their own,
so they first swap three small text messages — this is called **signalling**, and
**Supabase Realtime carries it**:

```
   Tutor browser                       Student browser
        |                                    |
        |  1. OFFER   "here is my video"     |
        |----------------------------------->|
        |  2. ANSWER  "here is mine"         |
        |<-----------------------------------|
        |  3. ICE     "try these addresses"  |
        |<---------------------------------->|
        |                                    |
        |======= video and audio ============|
                  (straight between them)
```

After that the video never touches any server. A free Google **STUN** server is
used once, only to tell each browser its own public address — it never sees any
video.

Two details worth pointing at:

- **Who calls whom.** If both sides send an offer at the same time the call
  breaks. The rule in the code is one line: whoever has the smaller user id
  makes the offer, the other waits.
- **The honest limit.** Without a **TURN** server (which costs money) roughly
  10–20% of connections fail on strict mobile networks. That is why the Jitsi
  mode exists as the everyday choice.

#### The room name

`meet.jit.si` rooms are public to anyone who knows the name, and batch ids are
just 1, 2, 3… — far too easy to guess. So every batch gets a random `room_code`
in the database, such as `hs-7-9f3ac81b20`.

### 2. Class chat

A real live chat, using **Supabase Realtime**. When anyone sends a message, it
appears on everyone else's screen straight away — nobody refreshes anything.

```js
supabase
  .channel('room-' + batchId)
  .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages',
        filter: 'batch_id=eq.' + batchId },
      (payload) => addBubble(payload.new))
  .subscribe();
```

That is the whole live part: *tell me when a row is added to `messages` for this
batch.* The `filter` matters — without it every browser would receive every
batch's messages.

The green **Live** badge next to "Class chat" shows the connection is working,
and turns red if it drops.

---

## The database

```
auth.users              built into Supabase — email + password
     │
profiles                name, phone, role (student / tutor / admin)
     ├──── wallets      balance          (made automatically by a trigger)
     ├──── transactions every money movement, never edited
     │
tutor_profiles          headline, bio, experience, approval status, rating
     ├──── tutor_credentials   certificates waiting to be checked
     │
     └──── batches      days, time, monthly fee, seats
                │
                ├──── enrolments   a student joined  ──► reviews
                ├──── messages     the class chat room
                │
                └──── subjects, areas    (fixed lists)

notifications           alerts for the bell menu
```

### Money is handled by the database, not the browser

There is **no update rule** on `wallets`. The browser is simply not allowed to
change a balance. Money only moves through two database functions:

**`top_up_wallet(amount)`** — adds money, records the transaction, sends a notification.

**`enrol_in_batch(batch_id)`** — the important one. It does all of this together,
or none of it:

```
lock the batch row      (so two students cannot take the last seat)
check the batch is open
check there is a free seat
check the student has not already joined
check the wallet has enough money
take the fee from the student
write the student's transaction
create the enrolment
add 1 to seats_taken
pay the tutor 85%          (the site keeps 15%)
notify the student and the tutor
```

If any line fails, everything is undone. A student can never lose money without
getting a seat, and a seat can never be given away for free.

### Rules the database enforces by itself

| Rule | Stops |
|---|---|
| `check (balance >= 0)` | A wallet going below zero |
| `check (monthly_fee >= 100)` | A free or negative fee |
| `check (end_time > start_time)` | A class ending before it starts |
| `check (rating between 1 and 5)` | A 0-star or 99-star review |
| `unique (batch_id, student_id)` | Joining the same batch twice |
| `unique (enrolment_id)` on reviews | Reviewing the same batch twice |
| `select ... for update` in `enrol_in_batch` | Two students taking one seat |

### Security (Row Level Security)

The Supabase key in `config.js` is public — that is normal. It is the **anon
public** key and it can only do what the security rules allow. 24 rules protect
the tables:

| Table | Read | Write |
|---|---|---|
| `profiles` | anyone | only your own row |
| `tutor_profiles` | anyone | the tutor, **or an admin** |
| `batches` | published ones from **approved** tutors, plus your own | only an **approved** tutor, only their own |
| `enrolments` | the student, the batch's tutor, or an admin | **nobody** — only `enrol_in_batch()` |
| `wallets` | only your own | **nobody** — only the two functions |
| `transactions` | only your own, or an admin | **nobody** |
| `reviews` | anyone | only for a batch you actually joined |
| `notifications` | only your own | mark your own as read |
| `messages` | only if you belong to that batch | only as yourself, only in your own batch |

Two of these are worth pointing at:

- **A tutor cannot publish until an admin approves them.** The insert rule on
  `batches` checks `tutor_profiles.status = 'approved'`. Changing the JavaScript
  does not help — the database refuses.
- **You cannot review a tutor you never paid.** The insert rule on `reviews`
  checks that the enrolment exists and belongs to you.

### Triggers (things the database does by itself)

| Trigger | What it does |
|---|---|
| `on_profile_created` | Gives every new user a wallet |
| `on_review_changed` | Recalculates the tutor's average rating |
| `on_tutor_status_changed` | Notifies a tutor when an admin approves or rejects them |
| `on_batch_went_live` | Notifies every student in a batch when the class starts |

---

## The code

| File | Job | Lines |
|---|---|---|
| `js/config.js` | Your two Supabase keys | 10 |
| `js/supabase.js` | Creates the one connection everyone shares | 9 |
| `js/format.js` | Time, money, dates, stars, initials, safe text | 65 |
| `js/ui.js` | Toast messages, confirm box, loading and empty states | 90 |
| `js/session.js` | Who is logged in, the top bar, the notification bell | 190 |
| `js/register.js` · `login.js` | Accounts | 80 + 40 |
| `js/browse.js` | Search and filters | 210 |
| `js/batch.js` | Batch page and joining | 250 |
| `js/student-wallet.js` · `student-dashboard.js` | Wallet, my classes, reviews | 120 + 220 |
| `js/tutor-profile.js` · `tutor-batches.js` | Onboarding, batch management | 200 + 250 |
| `js/tutor-dashboard.js` · `tutor-students.js` | Earnings, students | 200 + 130 |
| `js/admin-tutors.js` · `admin-dashboard.js` | Approvals, site overview | 220 + 200 |
| `js/batch-room.js` | The class room: modes, chat | 430 |
| `js/jitsi.js` | Embeds the Jitsi group class | 65 |
| `js/webrtc.js` | **Our own peer-to-peer video call** | 260 |
| `css/style.css` | The whole design system in one file | 650 |

### Things worth explaining

1. **`enrol_in_batch()`** — one database function does seat check, payment, seat,
   tutor payout and notifications together. This is the heart of the project.
2. **`upsert`** — one line handles both "saving for the first time" and "editing".
3. **Nested `select()`** — one request pulls a batch, its subject, its area, the
   tutor and the tutor's name. No manual joining in JavaScript.
4. **`safe()` in `format.js`** — every piece of user text goes through it before
   being put on the page, so a student cannot break the layout by typing `<script>`.
5. **Design tokens** — every colour and spacing value is named once at the top of
   `style.css`. Change one line and the whole site changes.
6. **Filters are added one at a time** — `if (feeFilter.value) query = query.lte(...)`.
   Six filters, six lines, one request.

---

## Design

- One stylesheet, no framework, no build step.
- Colours, spacing, radius and shadows are all named variables.
- Works on a phone: the menu collapses, cards stack, tables scroll sideways.
- Loading placeholders instead of blank screens, and a friendly message with a
  next step whenever a list is empty.
- Toast messages instead of `alert()`.
- Every button reachable by keyboard, with a visible focus ring.
- Respects "reduce motion" if the user has it switched on.

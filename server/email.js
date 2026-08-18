// ============================================================
//  EMAIL
//
//  Every notification the app already writes becomes an email
//  as well. Nothing in the app had to change for this: the
//  triggers and functions in schema.sql were already inserting
//  rows into notifications, and this file simply reads the
//  ones that have not been emailed yet.
//
//  How it works:
//
//    1. every 30 seconds, ask for notifications where
//       email_sent is false, oldest first
//    2. look up that person's email address
//    3. send it
//    4. tick email_sent so it is never sent twice
//
//  Why it lives on the server and not in the browser:
//  ticking email_sent needs the service role key, so a student
//  cannot mark their own mail as sent, and the SMTP password
//  never leaves this machine.
//
//  If the mail settings are missing the job simply does not
//  start. The website carries on exactly as before, with the
//  bell in the top bar still working. Email is an extra, not
//  a thing the app depends on.
// ============================================================

const nodemailer = require('nodemailer');

//  How often to look for new mail to send.
const EVERY_MS = 30 * 1000;

//  How many to send in one pass. Small, so a burst of activity
//  cannot hold the loop open for minutes.
const BATCH = 20;

//  Anything older than this is marked as sent WITHOUT emailing.
//  This matters the first time you switch email on: without it,
//  every notification ever written would be posted at once.
const TOO_OLD_HOURS = 24;

//  A bad address would otherwise be retried for ever, so give
//  up after a few goes. Kept in memory on purpose — a restart
//  is a fair reason to try again.
const MAX_TRIES = 3;
const tries = new Map();

let timer = null;

// ------------------------------------------------------------
//  Which settings are present?
// ------------------------------------------------------------
function missingSettings() {
  return [
    ['SMTP_HOST', process.env.SMTP_HOST],
    ['SMTP_USER', process.env.SMTP_USER],
    ['SMTP_PASS', process.env.SMTP_PASS],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
}

// ------------------------------------------------------------
//  Start the job. Returns what happened, so server.js can
//  print an honest line at boot.
// ------------------------------------------------------------
function startEmailWorker(db) {
  const missing = missingSettings();

  if (missing.length > 0) {
    return { on: false, missing };
  }
  if (!db) {
    return { on: false, missing: ['SUPABASE_SERVICE_ROLE_KEY'] };
  }

  const mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    //  port 465 is the one that is encrypted from the very
    //  first byte. Everything else starts plain and upgrades.
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const siteUrl = process.env.SITE_URL || 'http://localhost:5500';

  //  Run once now so a test does not need a 30 second wait,
  //  then keep running.
  const tick = () => sendPending(db, mailer, from, siteUrl);
  tick();
  timer = setInterval(tick, EVERY_MS);

  return { on: true, missing: [] };
}

function stopEmailWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}


// ------------------------------------------------------------
//  One pass.
// ------------------------------------------------------------
async function sendPending(db, mailer, from, siteUrl) {
  let rows;

  try {
    const { data, error } = await db
      .from('notifications')
      .select('id, user_id, title, body, link, created_at')
      .eq('email_sent', false)
      .order('created_at', { ascending: true })
      .limit(BATCH);

    if (error) throw error;
    rows = data || [];
  } catch (err) {
    console.error('email: could not read the queue:', err.message);
    return;
  }

  if (rows.length === 0) return;

  const cutoff = Date.now() - TOO_OLD_HOURS * 60 * 60 * 1000;

  for (const row of rows) {
    //  old backlog: tick it, do not post it
    if (new Date(row.created_at).getTime() < cutoff) {
      await markSent(db, row.id);
      continue;
    }

    if ((tries.get(row.id) || 0) >= MAX_TRIES) {
      console.error('email: giving up on notification', row.id);
      await markSent(db, row.id);
      tries.delete(row.id);
      continue;
    }

    try {
      const address = await emailFor(db, row.user_id);

      //  no address on the account is not an error worth
      //  retrying, so tick it and move on
      if (!address) {
        await markSent(db, row.id);
        continue;
      }

      await mailer.sendMail({
        from,
        to: address,
        subject: row.title,
        text: asText(row, siteUrl),
        html: asHtml(row, siteUrl),
      });

      await markSent(db, row.id);
      tries.delete(row.id);
    } catch (err) {
      tries.set(row.id, (tries.get(row.id) || 0) + 1);
      console.error('email: send failed for', row.id, '-', err.message);
    }
  }
}

async function markSent(db, id) {
  await db.from('notifications').update({ email_sent: true }).eq('id', id);
}

//  The email address lives with the login, not in profiles,
//  so it has to be looked up through the auth admin API.
async function emailFor(db, userId) {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error) throw error;
  return data?.user?.email || null;
}


// ------------------------------------------------------------
//  What the message looks like.
//
//  Plain text as well as HTML on purpose: some mail apps show
//  the text version, and a mail with only HTML is more likely
//  to be treated as spam.
// ------------------------------------------------------------
function asText(row, siteUrl) {
  const link = row.link ? siteUrl + '/' + row.link : siteUrl;

  return [
    row.title,
    '',
    row.body || '',
    '',
    'Open it here: ' + link,
    '',
    '—',
    'HelloStudents',
  ].join('\n');
}

function asHtml(row, siteUrl) {
  const link = row.link ? siteUrl + '/' + row.link : siteUrl;

  //  Inline styles only. Mail clients throw away <style> blocks,
  //  so anything in one would simply not apply.
  return `
<div style="font-family:Segoe UI,Helvetica,Arial,sans-serif;background:#FAFAFC;padding:28px">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E4E4E7;border-radius:16px;overflow:hidden">

    <div style="background:linear-gradient(100deg,#635BFF,#8B5CF6 52%,#38BDF8);padding:20px 26px">
      <span style="color:#fff;font-size:17px;font-weight:700">HelloStudents</span>
    </div>

    <div style="padding:26px">
      <h1 style="margin:0 0 10px;font-size:19px;color:#18181B">${escapeHtml(row.title)}</h1>
      ${row.body
        ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#52525B">${escapeHtml(row.body)}</p>`
        : ''}

      <a href="${escapeHtml(link)}"
         style="display:inline-block;background:#635BFF;color:#fff;text-decoration:none;
                font-size:14px;font-weight:600;padding:11px 20px;border-radius:10px">
        Open HelloStudents
      </a>
    </div>

    <div style="padding:16px 26px;border-top:1px solid #F1F1F4">
      <p style="margin:0;font-size:12px;color:#71717A">
        You are getting this because you have a HelloStudents account.
      </p>
    </div>

  </div>
</div>`;
}

//  The same job as safe() in the browser code: stop a name or a
//  batch title with a bracket in it from breaking the message.
function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

module.exports = { startEmailWorker, stopEmailWorker, missingSettings };

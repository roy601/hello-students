// ============================================================
//  TUTOR DASHBOARD
//
//  Numbers at a glance: money earned, students, batches and
//  rating. Then the batch list and recent earnings.
//
//  The site keeps 15% of every fee, so the tutor receives 85%.
// ============================================================

import { supabase } from './supabase.js';
import { mountPayout } from './payout.js';
import { renderTopbar, requireRole } from './session.js';
import { showLoading, showEmpty, renderPageHero, setupReveal } from './ui.js';
import { formatTime, taka, formatDate, stars, safe } from './format.js';

const statsBox = document.getElementById('stats');
const statusArea = document.getElementById('status-area');
const batchesBox = document.getElementById('batches');
const earningsBox = document.getElementById('earnings');

let me = null;

start();

async function start() {
  renderTopbar('tutor-dashboard.html');

  me = await requireRole('tutor');
  if (!me) return;

  // The heading greets the tutor by name, so it is drawn after
  // we know who they are.
  renderPageHero({
    eyebrow: 'Tutor',
    title: 'Hello, ' + safe(me.full_name),
    subtitle: 'How your teaching is going.',
    actions: '<a class="btn" href="tutor-batches.html">Open a new batch</a>',
  });
  setupReveal();

  await loadEverything();
}

async function loadEverything() {
  showLoading(batchesBox, 2);

  // 1. the tutor's own record (status, rating, students)
  const { data: tutor } = await supabase
    .from('tutor_profiles')
    .select('*')
    .eq('id', me.id)
    .maybeSingle();

  // 2. wallet balance
  const { data: wallet } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', me.id)
    .maybeSingle();

  // 3. batches
  const { data: batches } = await supabase
    .from('batches')
    .select('*, subjects ( name_en, grade_level )')
    .eq('tutor_id', me.id)
    .order('id', { ascending: false });

  // 4. earnings so far
  const { data: earnings } = await supabase
    .from('transactions')
    .select('*')
    .eq('kind', 'tutor_earning')
    .order('created_at', { ascending: false })
    .limit(10);

  showApprovalBanner(tutor?.status);
  showStats(tutor, wallet, batches || [], earnings || []);
  showBatches(batches || []);
  showEarnings(earnings || []);

  //  the withdraw box needs the balance, so it is mounted last
  await mountPayout(document.getElementById('payout'), me, wallet?.balance || 0);
}

function showApprovalBanner(status) {
  if (status === 'approved') {
    statusArea.innerHTML = '';
    return;
  }
  if (status === 'rejected') {
    statusArea.innerHTML = `
      <div class="alert alert-danger">
        <strong>Your application needs changes.</strong>
        <a href="tutor-profile.html">Update your profile</a> and we will look again.
      </div>`;
    return;
  }
  statusArea.innerHTML = `
    <div class="alert alert-warning">
      <strong>Waiting for approval.</strong>
      Your batches stay hidden until our team approves your account.
      <a href="tutor-profile.html">Complete your profile</a>.
    </div>`;
}

function showStats(tutor, wallet, batches, earnings) {
  const totalEarned = earnings.reduce((sum, row) => sum + row.amount, 0);
  const published = batches.filter((b) => b.is_published).length;
  const seatsFilled = batches.reduce((sum, b) => sum + b.seats_taken, 0);

  statsBox.innerHTML = `
    <div class="stat">
      <div class="label">Wallet</div>
      <div class="value brand">${taka(wallet?.balance || 0)}</div>
      <div class="sub">yours to withdraw, below</div>
    </div>
    <div class="stat">
      <div class="label">Earned recently</div>
      <div class="value">${taka(totalEarned)}</div>
      <div class="sub">after the 15% site fee</div>
    </div>
    <div class="stat">
      <div class="label">Students</div>
      <div class="value">${seatsFilled}</div>
      <div class="sub">${published} batches published</div>
    </div>
    <div class="stat">
      <div class="label">Rating</div>
      <div class="value">
        ${tutor?.rating_count > 0 ? tutor.rating_avg : '—'}
      </div>
      <div class="sub">
        ${tutor?.rating_count > 0
          ? `<span class="stars">${stars(tutor.rating_avg)}</span> ${tutor.rating_count} reviews`
          : 'no reviews yet'}
      </div>
    </div>`;
}

function showBatches(batches) {
  if (batches.length === 0) {
    showEmpty(
      batchesBox,
      'calendar',
      'No batches yet',
      'Open your first batch and students can start joining.',
      { href: 'tutor-batches.html', label: 'Open a batch' }
    );
    return;
  }

  batchesBox.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Batch</th><th>Days</th><th>Seats</th><th>Fee</th><th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${batches
            .map(
              (b) => `
            <tr>
              <td>
                <a href="batch.html?id=${b.id}">${safe(b.title)}</a>
                <div class="muted small">${safe(b.subjects.name_en)}</div>
              </td>
              <td class="muted nowrap">
                ${safe(b.days)}
                <div class="small">${formatTime(b.start_time)}</div>
              </td>
              <td class="nowrap">${b.seats_taken} / ${b.seat_limit}</td>
              <td class="strong money nowrap">${taka(b.monthly_fee)}</td>
              <td>${
                b.is_published
                  ? '<span class="badge badge-success">Live</span>'
                  : '<span class="badge">Draft</span>'
              }</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

function showEarnings(earnings) {
  if (earnings.length === 0) {
    earningsBox.innerHTML =
      '<p class="muted">No earnings yet. You get paid when a student joins one of your batches.</p>';
    return;
  }

  earningsBox.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Date</th><th>What happened</th><th>You earned</th></tr></thead>
        <tbody>
          ${earnings
            .map(
              (row) => `
            <tr>
              <td class="muted nowrap">${formatDate(row.created_at)}</td>
              <td>${safe(row.note || '')}</td>
              <td class="strong money nowrap text-success">+${taka(row.amount)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>`;
}

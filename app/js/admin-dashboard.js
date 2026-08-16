// ============================================================
//  ADMIN — SITE OVERVIEW
//
//  Counts and totals for the whole site.
//
//  GMV = all the fees students paid.
//  Site income = the 15% HelloStudents keeps.
//  Wallet money = money students added but have not spent.
//  That last one is money we owe back, not income.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar, requireRole } from './session.js';
import { showLoading, showEmpty, renderPageHero, setupReveal } from './ui.js';
import { taka, formatDate, safe, initials } from './format.js';

const moneyBox = document.getElementById('money-stats');
const peopleBox = document.getElementById('people-stats');
const pendingBox = document.getElementById('pending');
const recentBox = document.getElementById('recent-batches');

start();

async function start() {
  renderTopbar('admin-dashboard.html');
  renderPageHero({
    eyebrow: 'Admin',
    title: 'Site overview',
    subtitle: 'Money, people and classes across HelloStudents.',
    actions: '<a class="btn" href="admin-tutors.html">Tutor approvals</a>',
  });
  setupReveal();

  const me = await requireRole('admin');
  if (!me) return;

  await loadStats();
  await loadPending();
  await loadRecentBatches();
}

async function loadStats() {
  showLoading(moneyBox, 1);

  // All enrolments tell us how much money moved.
  const { data: enrolments } = await supabase.from('enrolments').select('fee_paid');

  const gmv = (enrolments || []).reduce((sum, e) => sum + e.fee_paid, 0);
  const siteIncome = Math.round(gmv * 0.15);
  const paidToTutors = gmv - siteIncome;

  // head: true means "just count, do not send the rows"
  const counts = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student'),
    supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'tutor'),
    supabase.from('tutor_profiles').select('id', { count: 'exact', head: true }).eq('status', 'approved'),
    supabase.from('tutor_profiles').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('batches').select('id', { count: 'exact', head: true }).eq('is_published', true),
    supabase.from('reviews').select('id', { count: 'exact', head: true }),
  ]);

  const [students, tutors, approved, pending, liveBatches, reviews] =
    counts.map((c) => c.count || 0);

  moneyBox.innerHTML = `
    <div class="stat">
      <div class="label">Total fees paid</div>
      <div class="value brand">${taka(gmv)}</div>
      <div class="sub">${(enrolments || []).length} enrolments</div>
    </div>
    <div class="stat">
      <div class="label">Site income</div>
      <div class="value">${taka(siteIncome)}</div>
      <div class="sub">15% of every fee</div>
    </div>
    <div class="stat">
      <div class="label">Paid to tutors</div>
      <div class="value">${taka(paidToTutors)}</div>
      <div class="sub">the other 85%</div>
    </div>
    <div class="stat">
      <div class="label">Average fee</div>
      <div class="value">${taka(
        (enrolments || []).length ? Math.round(gmv / enrolments.length) : 0
      )}</div>
      <div class="sub">per student, per month</div>
    </div>`;

  peopleBox.innerHTML = `
    <div class="stat">
      <div class="label">Students</div>
      <div class="value">${students}</div>
    </div>
    <div class="stat">
      <div class="label">Tutors</div>
      <div class="value">${tutors}</div>
      <div class="sub">${approved} approved, ${pending} waiting</div>
    </div>
    <div class="stat">
      <div class="label">Live batches</div>
      <div class="value">${liveBatches}</div>
    </div>
    <div class="stat">
      <div class="label">Reviews</div>
      <div class="value">${reviews}</div>
    </div>`;
}

// ---- Tutors still waiting ----------------------------------
async function loadPending() {
  const { data: tutors } = await supabase
    .from('tutor_profiles')
    .select('id, created_at, headline, profiles ( full_name )')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(5);

  if (!tutors || tutors.length === 0) {
    pendingBox.innerHTML = '<p class="muted">No tutors are waiting. Everything is checked.</p>';
    return;
  }

  pendingBox.innerHTML =
    tutors
      .map((t) => {
        const name = t.profiles?.full_name || 'Tutor';
        return `
        <div class="list-row">
          <div class="body">
            <div class="row">
              <div class="avatar">${initials(name)}</div>
              <div>
                <div class="strong">${safe(name)}</div>
                <div class="muted small">
                  ${safe(t.headline || 'No headline yet')} · applied ${formatDate(t.created_at)}
                </div>
              </div>
            </div>
          </div>
          <div class="side">
            <a class="btn btn-sm" href="admin-tutors.html">Review</a>
          </div>
        </div>`;
      })
      .join('');
}

// ---- Newest batches ----------------------------------------
async function loadRecentBatches() {
  const { data: batches } = await supabase
    .from('batches')
    .select(`
      id, title, monthly_fee, seats_taken, seat_limit, is_published, created_at,
      subjects ( name_en ),
      tutor_profiles ( profiles ( full_name ) )
    `)
    .order('created_at', { ascending: false })
    .limit(8);

  if (!batches || batches.length === 0) {
    showEmpty(recentBox, 'calendar', 'No batches yet', 'Batches appear here once tutors open them.');
    return;
  }

  recentBox.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Batch</th><th>Tutor</th><th>Fee</th><th>Seats</th><th>Status</th></tr>
        </thead>
        <tbody>
          ${batches
            .map(
              (b) => `
            <tr>
              <td>
                <a href="batch.html?id=${b.id}">${safe(b.title)}</a>
                <div class="muted small">${safe(b.subjects?.name_en || '')}</div>
              </td>
              <td class="muted">${safe(b.tutor_profiles?.profiles?.full_name || '')}</td>
              <td class="strong money nowrap">${taka(b.monthly_fee)}</td>
              <td class="nowrap">${b.seats_taken} / ${b.seat_limit}</td>
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

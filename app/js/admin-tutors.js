// ============================================================
//  ADMIN — TUTOR APPROVALS
//
//  An admin approves or rejects each new tutor, and marks
//  their certificates as checked.
//
//  Only an admin can reach this. The database also checks:
//  the update rule on tutor_profiles allows the tutor
//  themselves OR an admin, and nobody else.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar, requireRole } from './session.js';
import { toast, showLoading, showEmpty, renderPageHero, setupReveal } from './ui.js';
import { formatDate, safe, initials } from './format.js';

const statusFilter = document.getElementById('f-status');
const listBox = document.getElementById('tutors');

start();

async function start() {
  renderTopbar('admin-tutors.html');
  renderPageHero({
    eyebrow: 'Admin',
    title: 'Tutor approvals',
    subtitle: 'Check each tutor before their batches go live.',
  });
  setupReveal();

  const me = await requireRole('admin');
  if (!me) return;

  await loadTutors();
  statusFilter.addEventListener('change', loadTutors);
}

async function loadTutors() {
  showLoading(listBox, 3);

  let query = supabase
    .from('tutor_profiles')
    .select(`
      *,
      profiles ( full_name, phone, created_at ),
      areas ( name_en, city ),
      tutor_credentials ( id, title, institution, year_awarded, status )
    `)
    .order('created_at', { ascending: true });

  if (statusFilter.value !== 'all') {
    query = query.eq('status', statusFilter.value);
  }

  const { data: tutors, error } = await query;

  if (error) {
    listBox.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  if (!tutors || tutors.length === 0) {
    showEmpty(listBox, 'tick', 'Nothing here', 'There are no tutors in this list.');
    return;
  }

  listBox.innerHTML = tutors.map(tutorCard).join('');

  listBox.querySelectorAll('[data-approve]').forEach((b) =>
    b.addEventListener('click', () => decide(b.dataset.approve, 'approved'))
  );
  listBox.querySelectorAll('[data-reject]').forEach((b) =>
    b.addEventListener('click', () => rejectTutor(b.dataset.reject))
  );
  listBox.querySelectorAll('[data-verify]').forEach((b) =>
    b.addEventListener('click', () => verifyCredential(b.dataset.verify, b.dataset.tutor))
  );
}

function tutorCard(tutor) {
  const name = tutor.profiles?.full_name || 'Tutor';
  const creds = tutor.tutor_credentials || [];

  const statusBadge =
    tutor.status === 'approved'
      ? '<span class="badge badge-success">Approved</span>'
      : tutor.status === 'rejected'
        ? '<span class="badge badge-danger">Rejected</span>'
        : '<span class="badge badge-warning">Waiting</span>';

  // A simple checklist so the admin can decide quickly.
  const checks = [
    ['Headline written', Boolean(tutor.headline)],
    ['About section written', Boolean(tutor.bio && tutor.bio.length > 30)],
    ['Area chosen', Boolean(tutor.area_id)],
    ['At least one certificate', creds.length > 0],
  ];

  const checkHtml = checks
    .map(
      ([label, ok]) =>
        `<div class="row">
           <span class="${ok ? 'text-success' : 'text-danger'}">${ok ? '&#10003;' : '&#10007;'}</span>
           <span class="${ok ? '' : 'muted'}">${label}</span>
         </div>`
    )
    .join('');

  const credHtml = creds.length
    ? creds
        .map(
          (c) => `
        <div class="row">
          <span>${safe(c.title)} — ${safe(c.institution)}${c.year_awarded ? ', ' + c.year_awarded : ''}</span>
          ${
            c.status === 'verified'
              ? '<span class="badge badge-success">Checked</span>'
              : `<button class="btn btn-outline btn-sm" type="button"
                         data-verify="${c.id}" data-tutor="${tutor.id}">Mark checked</button>`
          }
        </div>`
        )
        .join('')
    : '<p class="muted">No certificates uploaded.</p>';

  const actions =
    tutor.status === 'approved'
      ? ''
      : `<div class="row-end mt">
           <button class="btn btn-outline" type="button" data-reject="${tutor.id}">Reject</button>
           <button class="btn" type="button" data-approve="${tutor.id}">Approve tutor</button>
         </div>`;

  return `
    <div class="card">
      <div class="card-head">
        <div class="row">
          <div class="avatar lg">${initials(name)}</div>
          <div>
            <h3>${safe(name)} ${statusBadge}</h3>
            <p class="muted">
              ${safe(tutor.profiles?.phone || 'No phone')} ·
              ${tutor.areas ? safe(tutor.areas.name_en + ', ' + tutor.areas.city) : 'No area'} ·
              ${tutor.years_experience} years experience
            </p>
            <p class="muted small">Applied ${formatDate(tutor.created_at)}</p>
          </div>
        </div>
      </div>

      <div class="grid-2">
        <div>
          <h4 class="mb-xs">Profile check</h4>
          ${checkHtml}
        </div>
        <div>
          <h4 class="mb-xs">Certificates</h4>
          <div class="stack-sm">${credHtml}</div>
        </div>
      </div>

      ${tutor.headline ? `<p class="lead mt">"${safe(tutor.headline)}"</p>` : ''}
      ${tutor.bio ? `<p class="muted mt-xs">${safe(tutor.bio)}</p>` : ''}

      ${actions}
    </div>`;
}

// ---- Approve or reject -------------------------------------
async function decide(tutorId, newStatus, reason) {
  const { error } = await supabase
    .from('tutor_profiles')
    .update({ status: newStatus, reject_reason: reason || null })
    .eq('id', tutorId);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  // The database sends the tutor a notification automatically
  // (see the on_tutor_status_changed trigger in schema.sql).
  toast(newStatus === 'approved' ? 'Tutor approved.' : 'Tutor rejected.', 'success');
  await loadTutors();
}

function rejectTutor(tutorId) {
  const reason = window.prompt(
    'What should this tutor fix? They will see this message.',
    'Please add a certificate and finish your about section.'
  );
  if (reason === null) return;
  decide(tutorId, 'rejected', reason);
}

// ---- Mark a certificate as checked -------------------------
async function verifyCredential(credId, tutorId) {
  const { error } = await supabase
    .from('tutor_credentials')
    .update({ status: 'verified' })
    .eq('id', credId);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  // A checked certificate gives the tutor their badge.
  await supabase
    .from('tutor_profiles')
    .update({ verified_level: 'certificate_verified' })
    .eq('id', tutorId);

  toast('Certificate marked as checked.', 'success');
  await loadTutors();
}

// ============================================================
//  TUTOR PROFILE  —  onboarding
//
//  A tutor fills in who they are and adds certificates.
//  An admin then approves the account. Until that happens the
//  tutor cannot publish any batch (the database blocks it).
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar, requireRole } from './session.js';
import { toast, busy, confirmBox, showLoading,
         renderPageHero, setupReveal } from './ui.js';
import { safe } from './format.js';

const statusArea = document.getElementById('status-area');
const aboutForm = document.getElementById('about-form');
const aboutBtn = document.getElementById('about-btn');
const areaSelect = document.getElementById('area');
const credForm = document.getElementById('cred-form');
const credBtn = document.getElementById('cred-btn');
const credList = document.getElementById('cred-list');

let me = null;

start();

async function start() {
  renderTopbar('tutor-profile.html');
  renderPageHero({
    eyebrow: 'Tutor',
    title: 'My tutor profile',
    subtitle: 'Students see this on every batch you open.',
  });
  setupReveal();

  me = await requireRole('tutor');
  if (!me) return;

  await loadAreas();
  await loadProfile();
  await loadCredentials();
}

// ---- Fill the area dropdown --------------------------------
async function loadAreas() {
  const { data: areas } = await supabase
    .from('areas')
    .select('*')
    .order('city')
    .order('name_en');

  areaSelect.innerHTML = '<option value="">Choose your area</option>';

  (areas || []).forEach((area) => {
    const option = document.createElement('option');
    option.value = area.id;
    option.textContent = area.name_en + ' (' + area.city + ')';
    areaSelect.appendChild(option);
  });
}

// ---- Load what the tutor saved before ----------------------
async function loadProfile() {
  const { data: tutor } = await supabase
    .from('tutor_profiles')
    .select('*')
    .eq('id', me.id)
    .maybeSingle();

  // A tutor who registered before this page existed may not
  // have a row yet, so make one.
  if (!tutor) {
    await supabase.from('tutor_profiles').insert({ id: me.id });
    showStatus('pending', null);
    return;
  }

  document.getElementById('headline').value = tutor.headline || '';
  document.getElementById('bio').value = tutor.bio || '';
  document.getElementById('experience').value = tutor.years_experience || 0;
  areaSelect.value = tutor.area_id || '';

  showStatus(tutor.status, tutor.reject_reason);
}

// ---- The approval banner at the top ------------------------
function showStatus(status, reason) {
  if (status === 'approved') {
    statusArea.innerHTML = `
      <div class="alert alert-success">
        <strong>&#10003; Your account is approved.</strong>
        You can open batches and take students.
      </div>`;
  } else if (status === 'rejected') {
    statusArea.innerHTML = `
      <div class="alert alert-danger">
        <strong>Your application needs changes.</strong><br />
        ${safe(reason || 'Please complete your profile and add a certificate.')}
      </div>`;
  } else if (status === 'suspended') {
    statusArea.innerHTML = `
      <div class="alert alert-danger">
        <strong>Your account is paused.</strong> Please contact support.
      </div>`;
  } else {
    statusArea.innerHTML = `
      <div class="alert alert-warning">
        <strong>Waiting for approval.</strong>
        Fill in your profile and add a certificate. Our team checks new
        tutors before their batches can go live.
      </div>`;
  }
}

// ---- Save the profile --------------------------------------
aboutForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  busy(aboutBtn, true, 'Saving...');

  // upsert = add the row if it is missing, update it if it exists
  const { error } = await supabase.from('tutor_profiles').upsert({
    id: me.id,
    headline: document.getElementById('headline').value.trim(),
    bio: document.getElementById('bio').value.trim(),
    years_experience: Number(document.getElementById('experience').value) || 0,
    area_id: areaSelect.value ? Number(areaSelect.value) : null,
  });

  busy(aboutBtn, false);

  if (error) {
    toast(error.message, 'error');
    return;
  }
  toast('Profile saved.', 'success');
});

// ---- Certificates ------------------------------------------
async function loadCredentials() {
  showLoading(credList, 1);

  const { data: creds } = await supabase
    .from('tutor_credentials')
    .select('*')
    .eq('tutor_id', me.id)
    .order('id', { ascending: false });

  if (!creds || creds.length === 0) {
    credList.innerHTML = '<p class="muted">No certificates added yet.</p>';
    return;
  }

  credList.innerHTML = creds.map(credHtml).join('');

  credList.querySelectorAll('[data-delete]').forEach((button) => {
    button.addEventListener('click', () => removeCredential(button.dataset.delete));
  });
}

function credHtml(cred) {
  const badge =
    cred.status === 'verified'
      ? '<span class="badge badge-success">&#10003; Checked</span>'
      : cred.status === 'rejected'
        ? '<span class="badge badge-danger">Not accepted</span>'
        : '<span class="badge badge-warning">Waiting</span>';

  return `
    <div class="list-row">
      <div class="body">
        <h4>${safe(cred.title)}</h4>
        <p class="muted">
          ${safe(cred.institution)}${cred.year_awarded ? ' · ' + cred.year_awarded : ''}
        </p>
      </div>
      <div class="side row-end">
        ${badge}
        <button class="btn btn-outline btn-sm" type="button"
                data-delete="${cred.id}">Remove</button>
      </div>
    </div>`;
}

credForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  busy(credBtn, true, 'Adding...');

  const yearValue = document.getElementById('cred-year').value;

  const { error } = await supabase.from('tutor_credentials').insert({
    tutor_id: me.id,
    title: document.getElementById('cred-title').value.trim(),
    institution: document.getElementById('cred-inst').value.trim(),
    year_awarded: yearValue ? Number(yearValue) : null,
  });

  busy(credBtn, false);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast('Certificate added. Our team will check it.', 'success');
  credForm.reset();
  await loadCredentials();
});

async function removeCredential(id) {
  const yes = await confirmBox(
    'Remove certificate?',
    'This cannot be undone.',
    'Remove'
  );
  if (!yes) return;

  const { error } = await supabase.from('tutor_credentials').delete().eq('id', id);

  if (error) {
    toast(error.message, 'error');
    return;
  }
  await loadCredentials();
}

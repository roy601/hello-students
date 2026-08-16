// ============================================================
//  TUTOR — MY STUDENTS
//
//  Lists everyone who joined this tutor's batches.
//  The security rule lets a tutor read an enrolment only if
//  the batch belongs to them, so no other tutor's students
//  can ever appear here.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar, requireRole } from './session.js';
import { showLoading, showEmpty, renderPageHero, setupReveal } from './ui.js';
import { taka, formatDate, safe, initials } from './format.js';

const batchFilter = document.getElementById('f-batch');
const studentsBox = document.getElementById('students');

let me = null;

start();

async function start() {
  renderTopbar('tutor-students.html');
  renderPageHero({
    eyebrow: 'Tutor',
    title: 'My students',
    subtitle: 'Everyone who has joined one of your batches.',
  });
  setupReveal();

  me = await requireRole('tutor');
  if (!me) return;

  await loadBatchList();
  await loadStudents();

  batchFilter.addEventListener('change', loadStudents);
}

// ---- Fill the "show which batch" dropdown ------------------
async function loadBatchList() {
  const { data: batches } = await supabase
    .from('batches')
    .select('id, title')
    .eq('tutor_id', me.id)
    .order('id', { ascending: false });

  (batches || []).forEach((batch) => {
    const option = document.createElement('option');
    option.value = batch.id;
    option.textContent = batch.title;
    batchFilter.appendChild(option);
  });
}

// ---- The student list --------------------------------------
async function loadStudents() {
  showLoading(studentsBox, 3);

  let query = supabase
    .from('enrolments')
    .select(`
      id, fee_paid, created_at,
      profiles ( full_name, phone ),
      batches!inner ( id, title, tutor_id )
    `)
    .eq('batches.tutor_id', me.id)
    .order('created_at', { ascending: false });

  if (batchFilter.value) {
    query = query.eq('batch_id', Number(batchFilter.value));
  }

  const { data: rows, error } = await query;

  if (error) {
    studentsBox.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  if (!rows || rows.length === 0) {
    showEmpty(
      studentsBox,
      'users',
      'No students yet',
      'Students appear here as soon as they join one of your batches.'
    );
    return;
  }

  const totalIncome = rows.reduce((sum, r) => sum + Math.round(r.fee_paid * 0.85), 0);

  studentsBox.innerHTML = `
    <div class="grid-2 mb">
      <div class="stat">
        <div class="label">Students</div>
        <div class="value brand">${rows.length}</div>
      </div>
      <div class="stat">
        <div class="label">Your share this month</div>
        <div class="value">${taka(totalIncome)}</div>
        <div class="sub">after the 15% site fee</div>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Student</th><th>Batch</th><th>Joined</th><th>You earned</th></tr>
        </thead>
        <tbody>
          ${rows.map(rowHtml).join('')}
        </tbody>
      </table>
    </div>`;
}

function rowHtml(row) {
  const name = row.profiles?.full_name || 'Student';
  const phone = row.profiles?.phone || '';
  const yourShare = Math.round(row.fee_paid * 0.85);

  return `
    <tr>
      <td>
        <div class="row">
          <div class="avatar">${initials(name)}</div>
          <div>
            <div class="strong">${safe(name)}</div>
            <div class="muted small">${safe(phone)}</div>
          </div>
        </div>
      </td>
      <td>${safe(row.batches?.title || '')}</td>
      <td class="muted nowrap">${formatDate(row.created_at)}</td>
      <td class="strong money nowrap text-success">${taka(yourShare)}</td>
    </tr>`;
}

// ============================================================
//  PEOPLE — who is in this batch
//
//  The teacher at the top, then every student who has joined.
//  A student sees names only. The tutor also sees phone
//  numbers, because they are the one who has to ring a parent
//  when somebody stops turning up.
//
//  Students can only see this list for a batch they are
//  actually in. That rule is the "classmates see each other"
//  policy in PART 11 of schema.sql.
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { showLoading } from './ui.js';
import { safe, initials, formatDate } from './format.js';

let ctx = null;

export async function mountPeople(element, context) {
  ctx = context;
  showLoading(element, 2);

  //  the teacher
  const { data: tutor } = await supabase
    .from('profiles')
    .select('id, full_name, phone')
    .eq('id', ctx.tutorId)
    .maybeSingle();

  //  everyone who joined
  const { data: students, error } = await supabase
    .from('enrolments')
    .select('id, created_at, student_id, profiles ( full_name, phone )')
    .eq('batch_id', ctx.batchId)
    .order('created_at', { ascending: true });

  if (error) {
    element.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  const list = students || [];

  element.innerHTML = `
    <section class="card people-block">
      <div class="people-head">
        <h2>Teacher</h2>
      </div>
      ${personRow(
        tutor?.full_name || 'Tutor',
        tutor?.phone,
        'Teacher',
        true
      )}
    </section>

    <section class="card people-block mt">
      <div class="people-head">
        <h2>Students</h2>
        <span class="badge">${list.length}</span>
      </div>

      ${list.length === 0
        ? `<div class="empty">
             <div class="empty-ico">${icon('users', 'ico-lg')}</div>
             <h3>No students yet</h3>
             <p class="muted">
               ${ctx.isTutor
                 ? 'Share your batch page and students can join from there.'
                 : 'You are the first one here.'}
             </p>
           </div>`
        : list
            .map((row) =>
              personRow(
                row.profiles?.full_name || 'Student',
                row.profiles?.phone,
                row.student_id === ctx.me.id
                  ? 'You'
                  : 'Joined ' + formatDate(row.created_at),
                false
              )
            )
            .join('')}
    </section>`;
}

// ------------------------------------------------------------
//  One line of the list.
// ------------------------------------------------------------
function personRow(name, phone, note, isTeacher) {
  //  only the tutor is shown phone numbers
  const showPhone = ctx.isTutor && phone;

  return `
    <div class="person">
      <span class="avatar ${isTeacher ? 'avatar-brand' : ''}">${initials(name)}</span>
      <span class="person-main">
        <span class="person-name">${safe(name)}</span>
        <span class="person-note">${safe(note)}</span>
      </span>
      ${showPhone ? `<a class="person-phone" href="tel:${safe(phone)}">${safe(phone)}</a>` : ''}
    </div>`;
}

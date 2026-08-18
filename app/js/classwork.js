// ============================================================
//  CLASSWORK — work the tutor sets, and marks
//
//  The tutor side:
//     set an assignment (with a due date and total marks)
//     or post material (something to read or watch)
//     then see who handed in, and give each one a mark
//
//  The student side:
//     see what is due, hand in an answer, and read the mark
//     and the tutor's feedback afterwards
//
//  Two rules matter and both live in the database, not here:
//     only the tutor of the batch can set work   (RLS)
//     only the tutor of the batch can mark work  (grade_work)
//  So a student cannot mark their own paper by editing this
//  file or by calling the API by hand.
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { toast, showLoading, busy, confirmBox } from './ui.js';
import { safe, initials, timeAgo, formatDate } from './format.js';

let ctx = null;
let box = null;
let work = [];          // assignments and materials, newest first
let mine = new Map();   // post id -> my own submission (students)
let counts = new Map(); // post id -> how many handed in (tutor)
let open = null;        // which piece of work is expanded

export async function mountClasswork(element, context) {
  ctx = context;
  box = element;

  box.innerHTML = `
    <div id="cw-top"></div>
    <div id="cw-list"></div>`;

  drawTop();
  await loadWork();
}

// ------------------------------------------------------------
//  The tutor gets a Create button. Students get a short line
//  telling them what this tab is.
// ------------------------------------------------------------
function drawTop() {
  const top = document.getElementById('cw-top');

  if (!ctx.isTutor) {
    top.innerHTML = `
      <p class="lead mb">Everything your teacher has set for this batch.</p>`;
    return;
  }

  top.innerHTML = `
    <div class="cw-head">
      <p class="lead">Set work for your students, then mark it here.</p>
      <button class="btn" type="button" id="cw-new">
        ${icon('book', 'ico-sm')} Create
      </button>
    </div>

    <div class="card mb" id="cw-form-card" hidden>
      <form id="cw-form">
        <div class="field">
          <label for="cw-kind">What are you posting?</label>
          <select id="cw-kind">
            <option value="assignment">Assignment — work to hand in</option>
            <option value="material">Material — something to read or watch</option>
          </select>
        </div>

        <div class="field">
          <label for="cw-title">Title</label>
          <input id="cw-title" type="text" maxlength="200" required
                 placeholder="Chapter 4 exercises" />
        </div>

        <div class="field">
          <label for="cw-body">Instructions <span class="muted">(optional)</span></label>
          <textarea id="cw-body" rows="4" maxlength="5000"
                    placeholder="Do questions 1 to 12. Show your working."></textarea>
        </div>

        <div class="field">
          <label for="cw-link">Link <span class="muted">(optional)</span></label>
          <input id="cw-link" type="url" placeholder="https://drive.google.com/..." />
        </div>

        <div class="grid-2" id="cw-assign-only">
          <div class="field">
            <label for="cw-due">Due date</label>
            <input id="cw-due" type="datetime-local" />
          </div>
          <div class="field">
            <label for="cw-points">Total marks</label>
            <input id="cw-points" type="number" min="1" max="1000" placeholder="20" />
          </div>
        </div>

        <div class="row-end mt">
          <button class="btn btn-outline" type="button" id="cw-cancel">Cancel</button>
          <button class="btn" type="submit" id="cw-save">Post to class</button>
        </div>
      </form>
    </div>`;

  const card = document.getElementById('cw-form-card');

  document.getElementById('cw-new').addEventListener('click', () => {
    card.hidden = !card.hidden;
    if (!card.hidden) document.getElementById('cw-title').focus();
  });

  document.getElementById('cw-cancel').addEventListener('click', () => {
    card.hidden = true;
    document.getElementById('cw-form').reset();
  });

  //  material has nothing to hand in, so it has no due date
  //  and no marks
  document.getElementById('cw-kind').addEventListener('change', (event) => {
    document.getElementById('cw-assign-only').hidden = event.target.value !== 'assignment';
  });

  document.getElementById('cw-form').addEventListener('submit', saveWork);
}

async function saveWork(event) {
  event.preventDefault();

  const save = document.getElementById('cw-save');
  const kind = document.getElementById('cw-kind').value;
  const due = document.getElementById('cw-due').value;
  const points = document.getElementById('cw-points').value;

  busy(save, true, 'Posting...');

  const { error } = await supabase.from('posts').insert({
    batch_id: ctx.batchId,
    author_id: ctx.me.id,
    kind,
    title: document.getElementById('cw-title').value.trim(),
    body: document.getElementById('cw-body').value.trim() || null,
    link_url: document.getElementById('cw-link').value.trim() || null,
    //  a datetime-local box gives local time with no zone, so
    //  turn it into a full timestamp the database understands
    due_at: kind === 'assignment' && due ? new Date(due).toISOString() : null,
    points: kind === 'assignment' && points ? Number(points) : null,
  });

  busy(save, false);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast('Posted. Your students have been notified.', 'success');
  document.getElementById('cw-form').reset();
  document.getElementById('cw-form-card').hidden = true;
  await loadWork();
}


// ============================================================
//  THE LIST OF WORK
// ============================================================
async function loadWork() {
  const list = document.getElementById('cw-list');
  showLoading(list, 3);

  const { data, error } = await supabase
    .from('posts')
    .select('id, kind, title, body, link_url, due_at, points, created_at')
    .eq('batch_id', ctx.batchId)
    .in('kind', ['assignment', 'material'])
    .order('created_at', { ascending: false });

  if (error) {
    list.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  work = data || [];

  if (work.length === 0) {
    list.innerHTML = `
      <div class="empty">
        <div class="empty-ico">${icon('book', 'ico-lg')}</div>
        <h3>No work yet</h3>
        <p class="muted">
          ${ctx.isTutor
            ? 'Use Create above to set your first assignment.'
            : 'Nothing has been set for this batch yet.'}
        </p>
      </div>`;
    return;
  }

  await loadProgress();

  list.innerHTML = work.map(workHtml).join('');
  wireList();
}

//  Students need their own submission for each assignment.
//  Tutors need the number handed in. One query each.
async function loadProgress() {
  mine = new Map();
  counts = new Map();

  const ids = work.filter((w) => w.kind === 'assignment').map((w) => w.id);
  if (ids.length === 0) return;

  if (ctx.isTutor) {
    const { data } = await supabase
      .from('submissions')
      .select('post_id, status')
      .in('post_id', ids);

    (data || []).forEach((row) => {
      const seen = counts.get(row.post_id) || { handed: 0, marked: 0 };
      seen.handed += 1;
      if (row.status === 'returned') seen.marked += 1;
      counts.set(row.post_id, seen);
    });
    return;
  }

  const { data } = await supabase
    .from('submissions')
    .select('id, post_id, note, link_url, status, marks, feedback, submitted_at')
    .in('post_id', ids)
    .eq('student_id', ctx.me.id);

  (data || []).forEach((row) => mine.set(row.post_id, row));
}


// ============================================================
//  ONE PIECE OF WORK
// ============================================================
function workHtml(item) {
  const isAssignment = item.kind === 'assignment';
  const expanded = open === item.id;

  return `
    <article class="card cw-item ${expanded ? 'open' : ''}" data-work="${item.id}">
      <button type="button" class="cw-row" data-open="${item.id}"
              aria-expanded="${expanded}">
        <span class="cw-ico ${item.kind}">
          ${icon(isAssignment ? 'book' : 'cap', 'ico-sm')}
        </span>
        <span class="cw-main">
          <span class="cw-title">${safe(item.title)}</span>
          <span class="cw-meta">${metaLine(item)}</span>
        </span>
        <span class="cw-state">${stateBadge(item)}</span>
      </button>

      ${expanded ? `<div class="cw-detail">${detailHtml(item)}</div>` : ''}
    </article>`;
}

function metaLine(item) {
  const bits = ['Posted ' + timeAgo(item.created_at)];

  if (item.due_at) bits.push('Due ' + formatDate(item.due_at));
  if (item.points) bits.push(item.points + ' marks');

  return safe(bits.join(' · '));
}

//  The badge on the right tells you where this stands.
function stateBadge(item) {
  if (item.kind !== 'assignment') return '<span class="badge">Material</span>';

  if (ctx.isTutor) {
    const seen = counts.get(item.id) || { handed: 0, marked: 0 };
    return `<span class="badge ${seen.handed ? 'badge-brand' : ''}">
              ${seen.handed} handed in
            </span>`;
  }

  const sub = mine.get(item.id);

  if (!sub) {
    const late = item.due_at && new Date(item.due_at) < new Date();
    return late
      ? '<span class="badge badge-danger">Missing</span>'
      : '<span class="badge">To do</span>';
  }
  if (sub.status === 'returned') {
    return `<span class="badge badge-success">
              ${sub.marks == null ? 'Marked' : sub.marks + ' / ' + (item.points ?? '?')}
            </span>`;
  }
  return '<span class="badge badge-brand">Handed in</span>';
}

//  What you see when you click a piece of work open.
function detailHtml(item) {
  const body = item.body ? `<p class="post-text">${safe(item.body)}</p>` : '';

  const link = item.link_url
    ? `<a class="post-link" href="${safe(item.link_url)}" target="_blank" rel="noopener noreferrer">
         ${icon('search', 'ico-sm')} <span>Open the link</span>
       </a>`
    : '';

  const tail = item.kind !== 'assignment'
    ? ''
    : ctx.isTutor
      ? `<div id="marking-${item.id}" class="marking"></div>`
      : handInHtml(item);

  const remove = ctx.isTutor
    ? `<button type="button" class="btn btn-outline btn-sm mt"
               data-del-work="${item.id}">Delete</button>`
    : '';

  return body + link + tail + remove;
}


// ============================================================
//  THE STUDENT SIDE — hand your answer in
// ============================================================
function handInHtml(item) {
  const sub = mine.get(item.id);
  const marked = sub && sub.status === 'returned';

  //  once it is marked it is finished, so show the result
  //  instead of the form
  if (marked) {
    return `
      <div class="hand-in done">
        <h4>Your work was marked</h4>
        <p class="marks-big">
          ${sub.marks == null ? '—' : sub.marks}
          <small>out of ${item.points ?? '?'}</small>
        </p>
        ${sub.feedback
          ? `<p class="post-text"><strong>Feedback:</strong> ${safe(sub.feedback)}</p>`
          : '<p class="muted">No written feedback was left.</p>'}
        ${sub.note ? `<p class="hint">You wrote: ${safe(sub.note)}</p>` : ''}
      </div>`;
  }

  return `
    <div class="hand-in">
      <h4>${sub ? 'Your answer' : 'Hand in your work'}</h4>
      ${sub
        ? `<p class="hint">Handed in ${timeAgo(sub.submitted_at)}.
             You can change it until it is marked.</p>`
        : ''}

      <div class="field">
        <label for="sub-note-${item.id}">Your answer</label>
        <textarea id="sub-note-${item.id}" rows="4" maxlength="5000"
                  placeholder="Type your answer, or say where you put it."
        >${safe(sub?.note || '')}</textarea>
      </div>

      <div class="field">
        <label for="sub-link-${item.id}">Link to your file <span class="muted">(optional)</span></label>
        <input id="sub-link-${item.id}" type="url" placeholder="https://drive.google.com/..."
               value="${safe(sub?.link_url || '')}" />
      </div>

      <button class="btn" type="button" data-hand-in="${item.id}" id="hand-${item.id}">
        ${sub ? 'Hand in again' : 'Hand in'}
      </button>
    </div>`;
}

async function handIn(postId) {
  const button = document.getElementById('hand-' + postId);
  const note = document.getElementById('sub-note-' + postId).value.trim();
  const link = document.getElementById('sub-link-' + postId).value.trim();

  if (note === '' && link === '') {
    toast('Write an answer or add a link first.', 'error');
    return;
  }

  busy(button, true, 'Handing in...');

  const { error } = await supabase.rpc('submit_work', {
    p_post_id: postId,
    p_note: note,
    p_link: link,
  });

  busy(button, false);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast('Handed in. Your teacher has been told.', 'success');
  await loadWork();
}


// ============================================================
//  THE TUTOR SIDE — mark what came in
// ============================================================
async function loadMarking(item) {
  const holder = document.getElementById('marking-' + item.id);
  if (!holder) return;

  showLoading(holder, 2);

  const { data, error } = await supabase
    .from('submissions')
    .select('id, student_id, note, link_url, status, marks, feedback, submitted_at, profiles ( full_name )')
    .eq('post_id', item.id)
    .order('submitted_at', { ascending: true });

  if (error) {
    holder.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  if (!data || data.length === 0) {
    holder.innerHTML = '<p class="muted mt">Nobody has handed this in yet.</p>';
    return;
  }

  holder.innerHTML = `
    <h4 class="mt">Handed in (${data.length})</h4>
    ${data.map((sub) => markRowHtml(sub, item)).join('')}`;

  holder.querySelectorAll('[data-mark]').forEach((button) =>
    button.addEventListener('click', () => saveMark(button.dataset.mark, item))
  );
}

function markRowHtml(sub, item) {
  const name = sub.profiles?.full_name || 'Student';
  const done = sub.status === 'returned';

  return `
    <div class="mark-row ${done ? 'done' : ''}">
      <div class="mark-who">
        <span class="avatar avatar-sm">${initials(name)}</span>
        <div>
          <div class="strong">${safe(name)}</div>
          <div class="hint">Handed in ${timeAgo(sub.submitted_at)}</div>
        </div>
      </div>

      ${sub.note ? `<p class="post-text">${safe(sub.note)}</p>` : ''}
      ${sub.link_url
        ? `<a class="post-link" href="${safe(sub.link_url)}"
              target="_blank" rel="noopener noreferrer">
             ${icon('search', 'ico-sm')} <span>Open their file</span>
           </a>`
        : ''}

      <div class="mark-fields">
        <div class="field">
          <label for="mk-${sub.id}">Marks out of ${item.points ?? '?'}</label>
          <input id="mk-${sub.id}" type="number" min="0" max="${item.points ?? 1000}"
                 value="${sub.marks == null ? '' : sub.marks}" />
        </div>
        <div class="field grow">
          <label for="fb-${sub.id}">Feedback</label>
          <input id="fb-${sub.id}" type="text" maxlength="1000"
                 placeholder="Well done, but check question 7."
                 value="${safe(sub.feedback || '')}" />
        </div>
        <button class="btn btn-sm" type="button" data-mark="${sub.id}" id="mkbtn-${sub.id}">
          ${done ? 'Update' : 'Return'}
        </button>
      </div>
    </div>`;
}

async function saveMark(submissionId, item) {
  const marksBox = document.getElementById('mk-' + submissionId);
  const button = document.getElementById('mkbtn-' + submissionId);
  const raw = marksBox.value.trim();

  busy(button, true, 'Saving...');

  const { error } = await supabase.rpc('grade_work', {
    p_submission_id: Number(submissionId),
    p_marks: raw === '' ? null : Number(raw),
    p_feedback: document.getElementById('fb-' + submissionId).value.trim(),
  });

  busy(button, false);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast('Returned to the student.', 'success');
  await loadMarking(item);
  await loadProgress();

  //  keep the badge on the row in step with what we just did
  const badge = box.querySelector(`[data-work="${item.id}"] .cw-state`);
  if (badge) badge.innerHTML = stateBadge(item);
}


// ============================================================
//  OPENING AND CLOSING A ROW
// ============================================================
function wireList() {
  const list = document.getElementById('cw-list');

  list.querySelectorAll('[data-open]').forEach((button) =>
    button.addEventListener('click', () => toggle(Number(button.dataset.open)))
  );

  list.querySelectorAll('[data-hand-in]').forEach((button) =>
    button.addEventListener('click', () => handIn(Number(button.dataset.handIn)))
  );

  list.querySelectorAll('[data-del-work]').forEach((button) =>
    button.addEventListener('click', () => removeWork(button.dataset.delWork))
  );

  //  if a tutor has a row open, fill in the marking list
  if (ctx.isTutor && open !== null) {
    const item = work.find((w) => w.id === open);
    if (item && item.kind === 'assignment') loadMarking(item);
  }
}

function toggle(id) {
  open = open === id ? null : id;

  const list = document.getElementById('cw-list');
  list.innerHTML = work.map(workHtml).join('');
  wireList();
}

async function removeWork(id) {
  const yes = await confirmBox(
    'Delete this?',
    'Anything students handed in for it will be deleted too.',
    'Delete'
  );
  if (!yes) return;

  const { error } = await supabase.from('posts').delete().eq('id', id);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  open = null;
  toast('Deleted.', 'success');
  await loadWork();
}

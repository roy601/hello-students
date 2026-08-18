// ============================================================
//  THE STREAM — the class wall
//
//  This is the noticeboard of a batch. Anyone in the batch can
//  put a note on it, and anyone in the batch can reply under
//  a note. That is how the tutor and the students talk to each
//  other between classes.
//
//  Work set by the tutor also shows up here, so nobody misses
//  it, but the marking side of it lives in classwork.js.
//
//  Who may do what is decided by the database, not by this
//  file (see PART 11 of schema.sql).
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { toast, showLoading, confirmBox } from './ui.js';
import { safe, initials, timeAgo, formatDate } from './format.js';

let ctx = null;         // { batchId, me, isTutor, tutorId }
let box = null;         // the tab we draw into
let posts = [];         // the wall, newest first
let comments = new Map(); // post id -> array of comments
let channel = null;

// ------------------------------------------------------------
//  Draw the tab. Called once, when the room opens.
// ------------------------------------------------------------
export async function mountStream(element, context) {
  ctx = context;
  box = element;

  box.innerHTML = `
    <div class="stream">
      <div id="composer"></div>
      <div id="wall"></div>
    </div>`;

  drawComposer();
  await loadWall();
  listen();
}

// ------------------------------------------------------------
//  The box you type a note into.
//
//  It starts closed, as one line, and opens when clicked. That
//  keeps the top of the page quiet when you only came to read.
// ------------------------------------------------------------
function drawComposer() {
  const holder = document.getElementById('composer');

  holder.innerHTML = `
    <div class="card composer">
      <button type="button" class="composer-shut" id="composer-open">
        <span class="avatar">${initials(ctx.me.full_name)}</span>
        <span class="composer-hint">Share something with your class...</span>
      </button>

      <form class="composer-body" id="composer-form" hidden>
        <label class="sr-only" for="post-body">Your message</label>
        <textarea id="post-body" rows="4" maxlength="5000"
                  placeholder="Write to everyone in this batch..."></textarea>
        <div class="row-end mt-sm">
          <button type="button" class="btn btn-outline btn-sm" id="post-cancel">
            Cancel
          </button>
          <button type="submit" class="btn btn-sm" id="post-send">Post</button>
        </div>
      </form>
    </div>`;

  const openBtn = document.getElementById('composer-open');
  const form = document.getElementById('composer-form');
  const field = document.getElementById('post-body');

  openBtn.addEventListener('click', () => {
    openBtn.hidden = true;
    form.hidden = false;
    field.focus();
  });

  document.getElementById('post-cancel').addEventListener('click', () => {
    field.value = '';
    form.hidden = true;
    openBtn.hidden = false;
  });

  form.addEventListener('submit', sendPost);
}

async function sendPost(event) {
  event.preventDefault();

  const field = document.getElementById('post-body');
  const send = document.getElementById('post-send');
  const text = field.value.trim();

  if (text === '' || send.disabled) return;   // stops double posts

  send.disabled = true;
  send.textContent = 'Posting...';

  const { error } = await supabase.from('posts').insert({
    batch_id: ctx.batchId,
    author_id: ctx.me.id,
    kind: 'announcement',
    body: text,
  });

  send.disabled = false;
  send.textContent = 'Post';

  if (error) {
    toast(error.message, 'error');
    return;
  }

  field.value = '';
  document.getElementById('composer-form').hidden = true;
  document.getElementById('composer-open').hidden = false;
  toast('Posted to the class.', 'success');

  await loadWall();
}


// ============================================================
//  READING THE WALL
// ============================================================
async function loadWall() {
  const wall = document.getElementById('wall');
  showLoading(wall, 2);

  const { data, error } = await supabase
    .from('posts')
    .select('id, kind, title, body, link_url, due_at, points, created_at, author_id, profiles ( full_name )')
    .eq('batch_id', ctx.batchId)
    .order('created_at', { ascending: false })
    .limit(60);

  if (error) {
    wall.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    return;
  }

  posts = data || [];

  if (posts.length === 0) {
    wall.innerHTML = `
      <div class="empty">
        <div class="empty-ico">${icon('chat', 'ico-lg')}</div>
        <h3>Nothing on the wall yet</h3>
        <p class="muted">
          ${ctx.isTutor
            ? 'Post a welcome message so your students know they are in the right place.'
            : 'When your teacher posts something, it will show up here.'}
        </p>
      </div>`;
    return;
  }

  await loadComments();

  wall.innerHTML = posts.map(postHtml).join('');
  wireWall();
}

//  All the comments for everything on screen, in one query.
//  Asking once for sixty posts is far quicker than asking
//  sixty times.
async function loadComments() {
  comments = new Map();

  const ids = posts.map((p) => p.id);
  if (ids.length === 0) return;

  const { data } = await supabase
    .from('post_comments')
    .select('id, post_id, body, created_at, author_id, profiles ( full_name )')
    .in('post_id', ids)
    .order('created_at', { ascending: true });

  (data || []).forEach((row) => {
    if (!comments.has(row.post_id)) comments.set(row.post_id, []);
    comments.get(row.post_id).push(row);
  });
}


// ============================================================
//  ONE NOTE ON THE WALL
// ============================================================
function postHtml(post) {
  const name = post.profiles?.full_name || 'Someone';
  const byTutor = post.author_id === ctx.tutorId;
  const mine = post.author_id === ctx.me.id;
  const canDelete = mine || ctx.isTutor;

  //  material and assignment posts get a coloured strip and a
  //  headline, announcements are just words
  const kindRow =
    post.kind === 'announcement'
      ? ''
      : `<div class="post-kind ${post.kind}">
           ${icon(post.kind === 'assignment' ? 'book' : 'cap', 'ico-sm')}
           <span>${post.kind === 'assignment' ? 'Assignment' : 'Material'}</span>
           ${post.due_at ? `<span class="post-due">Due ${formatDate(post.due_at)}</span>` : ''}
         </div>`;

  const titleRow = post.title ? `<h3 class="post-title">${safe(post.title)}</h3>` : '';
  const bodyRow = post.body ? `<p class="post-text">${safe(post.body)}</p>` : '';

  const linkRow = post.link_url
    ? `<a class="post-link" href="${safe(post.link_url)}" target="_blank" rel="noopener noreferrer">
         ${icon('search', 'ico-sm')}
         <span>${safe(shortLink(post.link_url))}</span>
       </a>`
    : '';

  return `
    <article class="card post">
      <header class="post-head">
        <span class="avatar ${byTutor ? 'avatar-brand' : ''}">${initials(name)}</span>
        <span class="post-who">
          <span class="post-name">
            ${safe(name)}
            ${byTutor ? '<span class="tag-teacher">Teacher</span>' : ''}
          </span>
          <span class="post-when">${timeAgo(post.created_at)}</span>
        </span>
        ${canDelete
          ? `<button type="button" class="post-x" data-del-post="${post.id}"
                     aria-label="Delete this post">${icon('cross', 'ico-sm')}</button>`
          : ''}
      </header>

      ${kindRow}
      ${titleRow}
      ${bodyRow}
      ${linkRow}

      ${commentsHtml(post.id)}
    </article>`;
}

//  The reply thread under a note.
function commentsHtml(postId) {
  const list = comments.get(postId) || [];

  const rows = list
    .map(
      (c) => `
      <div class="cmt" data-cmt="${c.id}">
        <span class="avatar avatar-sm">${initials(c.profiles?.full_name || '?')}</span>
        <span class="cmt-body">
          <span class="cmt-name">${safe(c.profiles?.full_name || 'Someone')}</span>
          <span class="cmt-text">${safe(c.body)}</span>
          <span class="cmt-when">${timeAgo(c.created_at)}</span>
        </span>
        ${c.author_id === ctx.me.id || ctx.isTutor
          ? `<button type="button" class="cmt-x" data-del-cmt="${c.id}"
                     aria-label="Delete this comment">${icon('cross', 'ico-sm')}</button>`
          : ''}
      </div>`
    )
    .join('');

  const count = list.length;

  return `
    <div class="post-foot">
      ${count > 0
        ? `<p class="cmt-count">${count} class ${count === 1 ? 'comment' : 'comments'}</p>`
        : ''}
      <div class="cmt-list">${rows}</div>

      <form class="cmt-form" data-cmt-form="${postId}">
        <span class="avatar avatar-sm">${initials(ctx.me.full_name)}</span>
        <label class="sr-only" for="cmt-in-${postId}">Add a class comment</label>
        <input id="cmt-in-${postId}" type="text" maxlength="2000" autocomplete="off"
               placeholder="Add a class comment..." />
        <button class="btn btn-sm" type="submit">Send</button>
      </form>
    </div>`;
}

function shortLink(url) {
  //  show the site name rather than a very long address
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}


// ============================================================
//  BUTTONS ON THE WALL
// ============================================================
function wireWall() {
  const wall = document.getElementById('wall');

  wall.querySelectorAll('[data-cmt-form]').forEach((form) =>
    form.addEventListener('submit', sendComment)
  );

  wall.querySelectorAll('[data-del-post]').forEach((button) =>
    button.addEventListener('click', () => removePost(button.dataset.delPost))
  );

  wall.querySelectorAll('[data-del-cmt]').forEach((button) =>
    button.addEventListener('click', () => removeComment(button.dataset.delCmt))
  );
}

async function sendComment(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const postId = Number(form.dataset.cmtForm);
  const input = form.querySelector('input');
  const send = form.querySelector('button');
  const text = input.value.trim();

  if (text === '' || send.disabled) return;

  send.disabled = true;
  input.value = '';

  const { error } = await supabase.from('post_comments').insert({
    post_id: postId,
    author_id: ctx.me.id,
    body: text,
  });

  send.disabled = false;

  if (error) {
    toast(error.message, 'error');
    input.value = text;         // give the words back
    return;
  }

  await loadWall();
}

async function removePost(id) {
  const yes = await confirmBox(
    'Delete this post?',
    'It will disappear for the whole class, along with its comments.',
    'Delete'
  );
  if (!yes) return;

  const { error } = await supabase.from('posts').delete().eq('id', id);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  toast('Post deleted.', 'success');
  await loadWall();
}

async function removeComment(id) {
  const { error } = await supabase.from('post_comments').delete().eq('id', id);

  if (error) {
    toast(error.message, 'error');
    return;
  }

  await loadWall();
}


// ============================================================
//  LIVE UPDATES
//
//  Supabase tells us when anyone in this batch posts or
//  comments, so the wall fills in by itself.
// ============================================================
function listen() {
  channel = supabase
    .channel('wall-' + ctx.batchId)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'posts',
        filter: 'batch_id=eq.' + ctx.batchId,
      },
      refresh
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'post_comments' },
      (payload) => {
        //  comments carry no batch_id, so only redraw if the
        //  comment belongs to a post we are showing
        const id = payload.new?.post_id ?? payload.old?.post_id;
        if (posts.some((p) => p.id === id)) refresh();
      }
    )
    .subscribe();
}

//  Redrawing the wall replaces every box on it, so anything
//  half typed would be lost. If someone is in the middle of
//  writing, wait until they stop before redrawing.
function refresh() {
  const wall = document.getElementById('wall');
  const typing = wall && wall.contains(document.activeElement);

  if (typing) {
    document.activeElement.addEventListener('blur', () => refresh(), { once: true });
    return;
  }

  loadWall();
}

//  Called by the room when the page is left.
export function stopStream() {
  if (channel) supabase.removeChannel(channel);
  channel = null;
}

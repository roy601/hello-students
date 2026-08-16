// ============================================================
//  Everything about "who is logged in".
//  Also draws the top bar, which is the same on every page.
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { initials, safe, timeAgo } from './format.js';

// Remembers the profile during one page visit so we do not
// ask the database for the same thing again and again.
let cachedProfile = null;

export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export async function getMyProfile() {
  if (cachedProfile) return cachedProfile;

  const user = await getUser();
  if (!user) return null;

  // maybeSingle = give me the row, or null if there is none
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  cachedProfile = data;
  return data;
}

// Send the visitor to the login page if they are not logged in.
export async function requireLogin() {
  const user = await getUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  return user;
}

// Only let one kind of user in ('tutor', 'student' or 'admin').
export async function requireRole(role) {
  const user = await requireLogin();
  if (!user) return null;

  const profile = await getMyProfile();
  if (!profile || profile.role !== role) {
    document.body.innerHTML = `
      <div class="page narrow mt-lg">
        <div class="empty">
          <div class="empty-ico">${icon('lock', 'ico-lg')}</div>
          <h3>This page is for ${role}s only</h3>
          <p class="muted">You are signed in as a ${safe(profile?.role || 'visitor')}.</p>
          <a class="btn mt" href="index.html">Go to home</a>
        </div>
      </div>`;
    return null;
  }
  return profile;
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}


// ============================================================
//  THE TOP BAR
//  Every page has <div id="topbar"></div>. This fills it in
//  with the right menu for whoever is looking at the page.
// ============================================================
export async function renderTopbar(activePage = '') {
  const holder = document.getElementById('topbar');
  if (!holder) return;

  const profile = await getMyProfile();

  // The menu links depend on who you are.
  let links = [{ href: 'browse.html', label: 'Find a batch' }];

  if (profile?.role === 'student') {
    links.push({ href: 'student-dashboard.html', label: 'My classes' });
    links.push({ href: 'student-wallet.html', label: 'Wallet' });
  } else if (profile?.role === 'tutor') {
    links.push({ href: 'tutor-dashboard.html', label: 'Dashboard' });
    links.push({ href: 'tutor-batches.html', label: 'My batches' });
    links.push({ href: 'tutor-students.html', label: 'Students' });
  } else if (profile?.role === 'admin') {
    links.push({ href: 'admin-dashboard.html', label: 'Overview' });
    links.push({ href: 'admin-tutors.html', label: 'Tutor approvals' });
  }

  const linksHtml = links
    .map((l) => {
      const active = l.href === activePage ? ' active' : '';
      return `<a class="nav-link${active}" href="${l.href}">${l.label}</a>`;
    })
    .join('');

  const rightSide = profile
    ? `
      <button class="bell" id="bell-btn" title="Notifications" aria-label="Notifications">
        ${icon('bell')}<span class="bell-dot" id="bell-dot" hidden>0</span>
      </button>
      <div class="nav-user">
        <div class="avatar" title="${safe(profile.full_name)}">${initials(profile.full_name)}</div>
        <button class="btn btn-outline btn-sm" id="logout-btn" type="button">Log out</button>
      </div>`
    : `
      <div class="nav-user no-border-left">
        <a class="nav-link" href="login.html">Login</a>
        <a class="btn btn-sm" href="register.html">Register</a>
      </div>`;

  holder.innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="logo" href="index.html">HelloStudents</a>
        <button class="menu-btn" id="menu-btn" type="button" aria-label="Menu">&#9776;</button>
        <nav class="nav" id="main-nav">
          ${linksHtml}
          ${rightSide}
        </nav>
      </div>
      <div class="dropdown" id="notif-box" hidden>
        <div class="dropdown-head">Notifications</div>
        <div id="notif-list"></div>
      </div>
    </header>`;

  // menu button on small screens
  document.getElementById('menu-btn').addEventListener('click', () => {
    document.getElementById('main-nav').classList.toggle('open');
  });

  if (profile) {
    document.getElementById('logout-btn').addEventListener('click', logout);
    setupNotifications();
  }
}


// ============================================================
//  NOTIFICATIONS (the bell)
// ============================================================
async function setupNotifications() {
  const bell = document.getElementById('bell-btn');
  const box = document.getElementById('notif-box');
  const list = document.getElementById('notif-list');
  const dot = document.getElementById('bell-dot');

  const { data: items } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(15);

  const unread = (items || []).filter((n) => !n.is_read).length;
  if (unread > 0) {
    dot.textContent = unread;
    dot.hidden = false;
  }

  if (!items || items.length === 0) {
    list.innerHTML = '<div class="notif"><span>No notifications yet.</span></div>';
  } else {
    list.innerHTML = items
      .map(
        (n) => `
        <a class="notif ${n.is_read ? '' : 'unread'}" href="${n.link || '#'}">
          <strong>${safe(n.title)}</strong>
          <span>${safe(n.body || '')}</span>
          <span class="small notif-time">${timeAgo(n.created_at)}</span>
        </a>`
      )
      .join('');
  }

  bell.addEventListener('click', async (e) => {
    e.stopPropagation();
    box.hidden = !box.hidden;

    // Opening the bell marks everything as read.
    if (!box.hidden && unread > 0) {
      dot.hidden = true;
      await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('is_read', false);
    }
  });

  document.addEventListener('click', () => {
    box.hidden = true;
  });
  box.addEventListener('click', (e) => e.stopPropagation());
}

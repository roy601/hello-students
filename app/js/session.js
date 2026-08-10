// ============================================================
//  Shared helpers about "who is logged in".
//  Used by every page.
// ============================================================

import { supabase } from './supabase.js';

// Returns the logged-in user, or null if nobody is logged in.
export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

// Returns the profile row (full_name, phone, role) of the logged-in user.
export async function getMyProfile() {
  const user = await getUser();
  if (!user) return null;

  // maybeSingle = return the row, or null if there is none.
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Could not load profile:', error.message);
    return null;
  }
  return data;
}

// Send the visitor to the login page if they are not logged in.
// Call this at the top of any page that needs a login.
export async function requireLogin() {
  const user = await getUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  return user;
}

export async function logout() {
  await supabase.auth.signOut();
  window.location.href = 'index.html';
}

// Fills the <nav> on every page: shows Login/Register when logged out,
// and the user's name + Logout when logged in.
export async function renderNav() {
  const nav = document.getElementById('nav-links');
  if (!nav) return;

  const profile = await getMyProfile();

  if (!profile) {
    nav.innerHTML = `
      <a href="browse.html">Find a batch</a>
      <a href="login.html">Login</a>
      <a class="btn-small" href="register.html">Register</a>
    `;
    return;
  }

  // A tutor gets an extra link to their own profile page.
  const tutorLink =
    profile.role === 'tutor'
      ? '<a href="tutor-profile.html">My batches</a>'
      : '';

  nav.innerHTML = `
    <a href="browse.html">Find a tutor</a>
    ${tutorLink}
    <span class="nav-user">${profile.full_name}</span>
    <button type="button" class="btn-small" id="logout-btn">Logout</button>
  `;

  document.getElementById('logout-btn').addEventListener('click', logout);
}

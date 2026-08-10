// ============================================================
//  LOGIN PAGE
// ============================================================

import { supabase } from './supabase.js';
import { renderNav, getMyProfile } from './session.js';

renderNav();

const form = document.getElementById('login-form');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = 'Logging in...';
  message.className = 'message';

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  const { error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    message.textContent = error.message;
    message.className = 'message error';
    return;
  }

  // Send tutors to their profile page, students to browse.
  const profile = await getMyProfile();
  window.location.href =
    profile && profile.role === 'tutor' ? 'tutor-profile.html' : 'browse.html';
});

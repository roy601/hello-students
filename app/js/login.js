// ============================================================
//  LOGIN PAGE
//  Sign in, then send each kind of user to their own page.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar, getMyProfile } from './session.js';
import { toast, busy } from './ui.js';

renderTopbar();

const form = document.getElementById('login-form');
const submitBtn = document.getElementById('submit-btn');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  busy(submitBtn, true, 'Logging in...');

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  const { error } = await supabase.auth.signInWithPassword({
    email: email,
    password: password,
  });

  if (error) {
    toast('Wrong email or password.', 'error');
    busy(submitBtn, false);
    return;
  }

  const profile = await getMyProfile();

  if (profile?.role === 'tutor') {
    window.location.href = 'tutor-dashboard.html';
  } else if (profile?.role === 'admin') {
    window.location.href = 'admin-dashboard.html';
  } else {
    window.location.href = 'browse.html';
  }
});

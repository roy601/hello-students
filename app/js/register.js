// ============================================================
//  REGISTER PAGE
//
//  Two steps:
//    1. supabase.auth.signUp()  -> creates the login
//    2. insert into 'profiles'  -> saves name, phone and role
//
//  A tutor also gets an empty tutor_profiles row, which starts
//  as 'pending' until an admin approves it.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar } from './session.js';
import { toast, busy } from './ui.js';

renderTopbar();

const form = document.getElementById('register-form');
const submitBtn = document.getElementById('submit-btn');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  busy(submitBtn, true, 'Creating account...');

  const fullName = document.getElementById('full-name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const role = document.getElementById('role').value;

  // --- Step 1: create the login -------------------------------
  const { data, error: signUpError } = await supabase.auth.signUp({
    email: email,
    password: password,
  });

  if (signUpError) {
    toast(signUpError.message, 'error');
    busy(submitBtn, false);
    return;
  }

  // If there is no session, "Confirm email" is still switched on
  // in Supabase, so step 2 would be blocked by the security rules.
  if (!data.session) {
    toast(
      'Account made, but email confirmation is on. Turn it off in ' +
        'Supabase: Authentication > Sign In / Providers > Email.',
      'error'
    );
    busy(submitBtn, false);
    return;
  }

  // --- Step 2: save the profile -------------------------------
  // The same id is used, which links the two tables together.
  const { error: profileError } = await supabase.from('profiles').insert({
    id: data.user.id,
    full_name: fullName,
    phone: phone,
    role: role,
  });

  if (profileError) {
    toast(profileError.message, 'error');
    busy(submitBtn, false);
    return;
  }

  // --- Step 3: tutors get a tutor profile too -----------------
  if (role === 'tutor') {
    await supabase.from('tutor_profiles').insert({ id: data.user.id });
    window.location.href = 'tutor-profile.html';
    return;
  }

  window.location.href = 'browse.html';
});

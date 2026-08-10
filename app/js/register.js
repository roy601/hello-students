// ============================================================
//  REGISTER PAGE
//
//  Two steps:
//    1. supabase.auth.signUp()  -> creates the login account
//    2. insert into 'profiles'  -> saves name, phone and role
// ============================================================

import { supabase } from './supabase.js';
import { renderNav } from './session.js';

renderNav();

const form = document.getElementById('register-form');
const message = document.getElementById('message');

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = 'Creating your account...';
  message.className = 'message';

  // Read what the user typed.
  const fullName = document.getElementById('full-name').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const role = document.getElementById('role').value;

  // --- Step 1: create the login account -----------------------
  const { data, error: signUpError } = await supabase.auth.signUp({
    email: email,
    password: password,
  });

  if (signUpError) {
    showError(signUpError.message);
    return;
  }

  // If there is no session, "Confirm email" is still switched on in
  // Supabase. Step 2 would then be blocked by the security rules,
  // so say so clearly instead of showing a confusing database error.
  if (!data.session) {
    showError(
      'Account created, but email confirmation is switched on. ' +
      'Turn it off in Supabase: Authentication > Sign In / Providers > Email.'
    );
    return;
  }

  // --- Step 2: save the profile row ---------------------------
  // data.user.id is the new user's id. We use the same id in
  // 'profiles' so the two tables stay linked.
  const { error: profileError } = await supabase.from('profiles').insert({
    id: data.user.id,
    full_name: fullName,
    phone: phone,
    role: role,
  });

  if (profileError) {
    showError(profileError.message);
    return;
  }

  // --- Done: send them where they need to go ------------------
  // A tutor goes to fill in their tutor profile.
  // A student goes straight to browsing.
  window.location.href =
    role === 'tutor' ? 'tutor-profile.html' : 'browse.html';
});

function showError(text) {
  message.textContent = text;
  message.className = 'message error';
}

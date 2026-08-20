// ============================================================
//  DARK MODE
//
//  Three settings, not two:
//
//    'light'   always light
//    'dark'    always dark
//    'system'  follow the computer's own setting
//
//  'system' is the one people forget. Someone whose laptop
//  turns dark at sunset expects this site to do the same, and
//  they never touched our button to say so.
//
//  The choice is kept in localStorage, so it survives a
//  refresh and every page uses the same one.
//
//  NOTE: the actual first paint is handled by a tiny script in
//  the <head> of every page, not by this file. A module loads
//  after the page has drawn, so relying on it would show a
//  flash of white before turning dark. That script and this
//  file must agree on the key name below.
// ============================================================

const KEY = 'hs-theme';

export function getTheme() {
  return localStorage.getItem(KEY) || 'system';
}

// ------------------------------------------------------------
//  Write the choice onto <html>, which is what the CSS reads.
//
//  For 'system' we remove the attribute entirely rather than
//  set it to anything, because the CSS media query only takes
//  over when no attribute is there.
// ------------------------------------------------------------
export function applyTheme(choice) {
  const root = document.documentElement;

  if (choice === 'system') {
    root.removeAttribute('data-theme');
    localStorage.removeItem(KEY);
    return;
  }

  root.setAttribute('data-theme', choice);
  localStorage.setItem(KEY, choice);
}

// ------------------------------------------------------------
//  What the button does.
//
//  Pressing it always lands on a definite choice, because
//  someone pressing a light/dark button wants light or dark,
//  not "it depends". Whatever is on screen now flips.
// ------------------------------------------------------------
export function toggleTheme() {
  const nowDark =
    document.documentElement.getAttribute('data-theme') === 'dark' ||
    (!document.documentElement.hasAttribute('data-theme') &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  applyTheme(nowDark ? 'light' : 'dark');
}

// ------------------------------------------------------------
//  If the person is on 'system' and their computer changes
//  while the page is open, follow it. Nothing to do beyond
//  keeping out of the way: with no attribute set, the CSS
//  media query has already switched by itself. This listener
//  only exists so the button's icon keeps up.
// ------------------------------------------------------------
export function watchSystemTheme(onChange) {
  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', () => {
      if (getTheme() === 'system' && onChange) onChange();
    });
}

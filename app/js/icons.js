// ============================================================
//  ICONS
//
//  Every icon on the site is drawn here as a small SVG.
//  Emoji were used before, but they look different on every
//  phone and often render as a broken square, so they are all
//  replaced with these.
//
//  Use:  icon('wallet')            normal size
//        icon('wallet', 'ico-lg')  big, for empty states
// ============================================================

const PATHS = {
  search:
    '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4.3-4.3"/>',

  sun:
    '<circle cx="12" cy="12" r="4.2"/>' +
    '<path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22"/>' +
    '<path d="M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/>',

  moon:
    '<path d="M20 14.2A8.2 8.2 0 019.8 4a8.4 8.4 0 108.4 10.2z"/>',

  book:
    '<path d="M4 5.5A2.5 2.5 0 016.5 3H19v15H6.5A2.5 2.5 0 004 20.5z"/>' +
    '<path d="M4 20.5A2.5 2.5 0 016.5 18H19v3H6.5A2.5 2.5 0 014 20.5z"/>',

  wallet:
    '<rect x="3" y="6" width="18" height="13" rx="2.5"/>' +
    '<path d="M3 10h18"/><circle cx="17" cy="14.5" r="1.3"/>',

  calendar:
    '<rect x="3" y="5" width="18" height="16" rx="2.5"/>' +
    '<path d="M3 10h18M8 3v4M16 3v4"/>',

  users:
    '<circle cx="9" cy="8" r="3.2"/>' +
    '<path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/>' +
    '<path d="M16 11.5a3 3 0 000-6M18 20c0-2.6-1-4.4-2.5-5.3"/>',

  lock:
    '<rect x="4.5" y="10" width="15" height="10.5" rx="2.5"/>' +
    '<path d="M8 10V7a4 4 0 018 0v3"/>',

  bell:
    '<path d="M6 9a6 6 0 1112 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z"/>' +
    '<path d="M10 18.5a2 2 0 004 0"/>',

  video:
    '<rect x="3" y="6" width="12.5" height="12" rx="2.5"/>' +
    '<path d="M15.5 10.5L21 7.5v9l-5.5-3z"/>',

  shield:
    '<path d="M12 3l7 3v5c0 4.4-3 8.3-7 10-4-1.7-7-5.6-7-10V6l7-3z"/>' +
    '<path d="M9 12l2 2 4-4"/>',

  cap:
    '<path d="M12 4l9 4.5-9 4.5-9-4.5L12 4z"/>' +
    '<path d="M6.5 10.5V16c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-5.5"/>',

  tick:
    '<circle cx="12" cy="12" r="9"/><path d="M8 12.2l2.6 2.6L16 9.4"/>',

  cross:
    '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',

  star:
    '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',

  chart:
    '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',

  chat:
    '<path d="M4 5.5h16v11H9l-5 4V5.5z"/>',
};

// Returns the SVG for one icon as a string of HTML.
export function icon(name, extraClass = '') {
  const body = PATHS[name] || PATHS.tick;
  return (
    `<svg class="ico ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">` +
    body +
    '</svg>'
  );
}

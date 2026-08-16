// ============================================================
//  Small helpers that turn stored values into readable text.
// ============================================================

// '16:00:00'  ->  '4:00 PM'
export function formatTime(timeText) {
  if (!timeText) return '';
  const [hourText, minuteText] = timeText.split(':');
  let hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  if (hour === 0) hour = 12;
  else if (hour > 12) hour = hour - 12;
  return hour + ':' + minuteText + ' ' + suffix;
}

// 2500  ->  '৳2,500'
export function taka(amount) {
  return '৳' + Number(amount || 0).toLocaleString('en-US');
}

// '2026-08-15T09:12:00Z'  ->  '15 Aug 2026'
export function formatDate(isoText) {
  if (!isoText) return '';
  return new Date(isoText).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// '2026-08-15T09:12:00Z'  ->  '2 hours ago'
export function timeAgo(isoText) {
  const seconds = (Date.now() - new Date(isoText).getTime()) / 1000;
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
  if (seconds < 604800) return Math.floor(seconds / 86400) + ' days ago';
  return formatDate(isoText);
}

// 4.5  ->  '★★★★☆'
export function stars(rating) {
  const filled = Math.round(Number(rating) || 0);
  return '★'.repeat(filled) + '☆'.repeat(5 - filled);
}

// 'Rifat Hossain'  ->  'RH'   (used for the round avatar)
export function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const first = parts[0][0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

// Stops text typed by a user from breaking the page layout.
// Always use this before putting user text inside innerHTML.
export function safe(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

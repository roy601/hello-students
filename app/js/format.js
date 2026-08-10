// ============================================================
//  Small display helpers used by more than one page.
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
export function formatTaka(amount) {
  return '৳' + Number(amount).toLocaleString('en-US');
}

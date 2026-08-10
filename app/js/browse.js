// ============================================================
//  FEATURE 2 — BROWSE AND SEARCH BATCHES
//
//  Anyone (even a visitor who is not logged in) can:
//    - see all published batches
//    - filter by subject, area and maximum MONTHLY FEE
//    - search by batch name
//
//  Students look for a batch to join, not for an hourly tutor,
//  so the price shown is always "per month".
// ============================================================

import { supabase } from './supabase.js';
import { renderNav } from './session.js';
import { formatTime, formatTaka } from './format.js';

const subjectFilter = document.getElementById('filter-subject');
const areaFilter = document.getElementById('filter-area');
const feeFilter = document.getElementById('filter-fee');
const nameFilter = document.getElementById('filter-name');
const resultsBox = document.getElementById('results');
const countLabel = document.getElementById('result-count');

start();

async function start() {
  renderNav();
  await loadFilterOptions();
  await search();
}

// ---- Fill the two dropdowns --------------------------------
async function loadFilterOptions() {
  const { data: subjects } = await supabase
    .from('subjects')
    .select('*')
    .order('id');

  subjects.forEach((subject) => {
    const option = document.createElement('option');
    option.value = subject.id;
    option.textContent = subject.name_en + ' · ' + subject.grade_level;
    subjectFilter.appendChild(option);
  });

  const { data: areas } = await supabase.from('areas').select('*').order('city');

  areas.forEach((area) => {
    const option = document.createElement('option');
    option.value = area.id;
    option.textContent = area.name_en + ' (' + area.city + ')';
    areaFilter.appendChild(option);
  });
}

// ---- Run the search ----------------------------------------
async function search() {
  resultsBox.innerHTML = '<p class="muted">Loading...</p>';

  // Start with all published batches.
  // The nested parts pull in the linked rows:
  //   subjects       -> the subject name
  //   areas          -> the area name
  //   tutor_profiles -> the tutor's headline, and inside it,
  //                     profiles -> the tutor's name
  let query = supabase
    .from('batches')
    .select(`
      id,
      title,
      days,
      start_time,
      end_time,
      monthly_fee,
      seat_limit,
      is_online,
      subjects ( name_en, grade_level ),
      areas ( name_en, city ),
      tutor_profiles ( headline, profiles ( full_name ) )
    `)
    .eq('is_published', true);

  // Add each filter only if the user actually chose something.
  if (subjectFilter.value) {
    query = query.eq('subject_id', Number(subjectFilter.value));
  }
  if (areaFilter.value) {
    query = query.eq('area_id', Number(areaFilter.value));
  }
  if (feeFilter.value) {
    query = query.lte('monthly_fee', Number(feeFilter.value));
  }
  if (nameFilter.value.trim()) {
    query = query.ilike('title', '%' + nameFilter.value.trim() + '%');
  }

  // Cheapest monthly fee first.
  query = query.order('monthly_fee', { ascending: true });

  const { data: batches, error } = await query;

  if (error) {
    resultsBox.innerHTML = '<p class="message error">' + error.message + '</p>';
    return;
  }

  showResults(batches);
}

// ---- Draw the result cards ---------------------------------
function showResults(batches) {
  countLabel.textContent = batches.length + ' batch(es) found';

  if (batches.length === 0) {
    resultsBox.innerHTML = `
      <div class="empty">
        <p>No batches match these filters.</p>
        <p class="muted">Try removing a filter or raising the monthly fee limit.</p>
      </div>
    `;
    return;
  }

  resultsBox.innerHTML = '';

  batches.forEach((batch) => {
    const tutorName = batch.tutor_profiles.profiles.full_name;
    const headline = batch.tutor_profiles.headline || '';

    const place = batch.is_online
      ? 'Online'
      : batch.areas
        ? batch.areas.name_en + ', ' + batch.areas.city
        : 'Area not set';

    const schedule =
      batch.days +
      ' · ' +
      formatTime(batch.start_time) +
      '–' +
      formatTime(batch.end_time);

    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <div class="card-main">
        <h3>${batch.title}</h3>
        <p class="headline">
          ${batch.subjects.name_en} · ${batch.subjects.grade_level}
        </p>
        <p class="muted">${schedule}</p>
        <p class="muted">${place} · ${batch.seat_limit} seats</p>
        <p class="bio">with ${tutorName}${headline ? ' — ' + headline : ''}</p>
      </div>
      <div class="card-side">
        <p class="price">${formatTaka(batch.monthly_fee)}</p>
        <p class="muted">per month</p>
      </div>
    `;
    resultsBox.appendChild(card);
  });
}

// ---- Run the search again whenever a filter changes ---------
subjectFilter.addEventListener('change', search);
areaFilter.addEventListener('change', search);
feeFilter.addEventListener('change', search);

// For typing, wait until the user stops for 300ms before searching,
// so we do not send one request per key press.
let typingTimer = null;
nameFilter.addEventListener('input', () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(search, 300);
});

document.getElementById('clear-filters').addEventListener('click', () => {
  subjectFilter.value = '';
  areaFilter.value = '';
  feeFilter.value = '';
  nameFilter.value = '';
  search();
});

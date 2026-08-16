// ============================================================
//  FEATURE — BROWSE AND SEARCH BATCHES
//
//  Open to everyone, even visitors who are not logged in.
//  The security rule only shows published batches that belong
//  to an approved tutor, so nothing else can appear here.
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar } from './session.js';
import { showLoading, showEmpty, renderPageHero, setupReveal } from './ui.js';
import { formatTime, taka, stars, safe } from './format.js';

const subjectFilter = document.getElementById('f-subject');
const areaFilter = document.getElementById('f-area');
const feeFilter = document.getElementById('f-fee');
const modeFilter = document.getElementById('f-mode');
const searchBox = document.getElementById('f-search');
const sortBox = document.getElementById('f-sort');
const resultsBox = document.getElementById('results');
const countLabel = document.getElementById('result-count');

start();

async function start() {
  renderTopbar('browse.html');
  renderPageHero({
    eyebrow: 'Group classes near you',
    title: 'Find a batch',
    subtitle: 'Fees are per student, per month. Filter by subject, area and price.',
  });
  setupReveal();
  await loadFilterOptions();
  readFiltersFromUrl();
  await search();
}

// ---- Fill the dropdowns from the database ------------------
async function loadFilterOptions() {
  const { data: subjects } = await supabase
    .from('subjects')
    .select('*')
    .order('grade_level')
    .order('name_en');

  (subjects || []).forEach((s) => {
    const option = document.createElement('option');
    option.value = s.id;
    option.textContent = s.name_en + ' · ' + s.grade_level;
    subjectFilter.appendChild(option);
  });

  const { data: areas } = await supabase
    .from('areas')
    .select('*')
    .order('city')
    .order('name_en');

  (areas || []).forEach((a) => {
    const option = document.createElement('option');
    option.value = a.id;
    option.textContent = a.name_en + ' (' + a.city + ')';
    areaFilter.appendChild(option);
  });
}

// ---- Let another page link straight to a filtered list -----
// e.g. browse.html?subject=4
function readFiltersFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('subject')) subjectFilter.value = params.get('subject');
  if (params.get('area')) areaFilter.value = params.get('area');
}

// ---- Run the search ----------------------------------------
async function search() {
  showLoading(resultsBox, 3);

  // One request brings back the batch, its subject, its area,
  // and the tutor (and inside the tutor, their name).
  let query = supabase
    .from('batches')
    .select(`
      id, title, days, start_time, end_time, monthly_fee,
      seat_limit, seats_taken, is_online, created_at,
      subjects ( name_en, grade_level ),
      areas ( name_en, city ),
      tutor_profiles ( rating_avg, rating_count, verified_level,
                       profiles ( full_name ) )
    `)
    .eq('is_published', true);

  // Each filter is added only if the user chose something.
  if (subjectFilter.value) query = query.eq('subject_id', Number(subjectFilter.value));
  if (areaFilter.value) query = query.eq('area_id', Number(areaFilter.value));
  if (feeFilter.value) query = query.lte('monthly_fee', Number(feeFilter.value));
  if (modeFilter.value === 'online') query = query.eq('is_online', true);
  if (modeFilter.value === 'person') query = query.eq('is_online', false);
  if (searchBox.value.trim()) query = query.ilike('title', '%' + searchBox.value.trim() + '%');

  if (sortBox.value === 'fee') query = query.order('monthly_fee', { ascending: true });
  else if (sortBox.value === 'new') query = query.order('created_at', { ascending: false });
  else query = query.order('created_at', { ascending: false });

  const { data: batches, error } = await query;

  if (error) {
    resultsBox.innerHTML = '<div class="alert alert-danger">' + safe(error.message) + '</div>';
    countLabel.textContent = '';
    return;
  }

  let list = batches || [];

  // "Best rated" needs the tutor rating, which lives one level
  // down, so it is easier to sort here than in the database.
  if (sortBox.value === 'rating') {
    list.sort((a, b) =>
      (b.tutor_profiles?.rating_avg || 0) - (a.tutor_profiles?.rating_avg || 0));
  }

  showResults(list);
}

// ---- Draw the cards ----------------------------------------
function showResults(batches) {
  countLabel.textContent =
    batches.length === 1 ? '1 batch found' : batches.length + ' batches found';

  if (batches.length === 0) {
    showEmpty(
      resultsBox,
      'search',
      'No batches match',
      'Try removing a filter, raising the fee limit, or looking at online batches.'
    );
    return;
  }

  resultsBox.innerHTML = batches.map(cardHtml).join('');
}

function cardHtml(batch) {
  const tutor = batch.tutor_profiles;
  const tutorName = tutor?.profiles?.full_name || 'Tutor';
  const seatsLeft = batch.seat_limit - batch.seats_taken;

  const place = batch.is_online
    ? 'Online'
    : batch.areas
      ? batch.areas.name_en + ', ' + batch.areas.city
      : 'Area not set';

  const ratingHtml =
    tutor?.rating_count > 0
      ? `<span class="stars">${stars(tutor.rating_avg)}</span>
         <span class="muted">${tutor.rating_avg} (${tutor.rating_count})</span>`
      : '<span class="muted">New tutor</span>';

  const verifiedHtml =
    tutor?.verified_level === 'certificate_verified'
      ? '<span class="badge badge-brand">Certificate checked</span>'
      : tutor?.verified_level === 'id_verified'
        ? '<span class="badge badge-success">ID checked</span>'
        : '';

  const seatsHtml =
    seatsLeft <= 0
      ? '<span class="badge badge-danger">Full</span>'
      : seatsLeft <= 3
        ? `<span class="badge badge-warning">Only ${seatsLeft} seats left</span>`
        : `<span class="badge">${seatsLeft} seats left</span>`;

  return `
    <a class="batch-card" href="batch.html?id=${batch.id}">
      <div class="body">
        <h3>${safe(batch.title)}</h3>
        <p class="meta">
          ${safe(batch.subjects.name_en)} · ${safe(batch.subjects.grade_level)}
        </p>
        <p class="meta">
          ${safe(batch.days)} · ${formatTime(batch.start_time)}–${formatTime(batch.end_time)}
        </p>
        <p class="meta">${safe(place)} · with ${safe(tutorName)}</p>
        <div class="row mt-xs">${ratingHtml} ${verifiedHtml} ${seatsHtml}</div>
      </div>
      <div class="side">
        <div class="price">${taka(batch.monthly_fee)}<small>per month</small></div>
      </div>
    </a>`;
}

// ---- Re-run the search when a filter changes ---------------
[subjectFilter, areaFilter, feeFilter, modeFilter, sortBox].forEach((control) => {
  control.addEventListener('change', search);
});

// While typing, wait until the user stops for 300ms, so we do
// not send one request per key press.
let typingTimer = null;
searchBox.addEventListener('input', () => {
  clearTimeout(typingTimer);
  typingTimer = setTimeout(search, 300);
});

document.getElementById('clear-filters').addEventListener('click', () => {
  subjectFilter.value = '';
  areaFilter.value = '';
  feeFilter.value = '';
  modeFilter.value = '';
  searchBox.value = '';
  sortBox.value = 'fee';
  search();
});

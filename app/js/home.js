// ============================================================
//  LANDING PAGE
//
//  The point of this page is that a visitor understands the
//  site without reading anything. So instead of describing
//  batches in words, we show REAL batches from the database,
//  floating in 3D.
//
//  Three jobs:
//    1. fill the hero search boxes
//    2. show real batches in the 3D deck (or samples if the
//       site is brand new and has none yet)
//    3. make the 3D react to the mouse, and fade sections in
// ============================================================

import { supabase } from './supabase.js';
import { renderTopbar } from './session.js';
import { taka, formatTime, safe } from './format.js';

start();

async function start() {
  renderTopbar('index.html');

  setupTilt();
  setupReveal();

  await Promise.all([loadSearchBoxes(), loadDeck(), loadStats()]);
}


// ============================================================
//  1. HERO SEARCH
// ============================================================
async function loadSearchBoxes() {
  const subjectBox = document.getElementById('h-subject');
  const areaBox = document.getElementById('h-area');

  const { data: subjects } = await supabase
    .from('subjects')
    .select('id, name_en, grade_level')
    .order('grade_level')
    .order('name_en');

  (subjects || []).forEach((s) => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name_en + ' · ' + s.grade_level;
    subjectBox.appendChild(opt);
  });

  const { data: areas } = await supabase
    .from('areas')
    .select('id, name_en, city')
    .order('city')
    .order('name_en');

  (areas || []).forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name_en + ' (' + a.city + ')';
    areaBox.appendChild(opt);
  });

  // Send the choices to the browse page, which already knows
  // how to read them out of the address bar.
  document.getElementById('hero-search').addEventListener('submit', (e) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (subjectBox.value) params.set('subject', subjectBox.value);
    if (areaBox.value) params.set('area', areaBox.value);
    window.location.href = 'browse.html?' + params.toString();
  });

  // Subject shortcut chips, first six subjects
  const chipRow = document.getElementById('chip-row');
  (subjects || []).slice(0, 6).forEach((s) => {
    const chip = document.createElement('a');
    chip.className = 'chip';
    chip.href = 'browse.html?subject=' + s.id;
    chip.textContent = s.name_en + ' · ' + s.grade_level;
    chipRow.appendChild(chip);
  });
}


// ============================================================
//  2. THE 3D CARD DECK
// ============================================================
async function loadDeck() {
  const deck = document.getElementById('deck');

  const { data: batches } = await supabase
    .from('batches')
    .select(`
      id, title, days, start_time, end_time, monthly_fee,
      seat_limit, seats_taken, is_online,
      subjects ( name_en, grade_level ),
      areas ( name_en ),
      tutor_profiles ( rating_avg, rating_count )
    `)
    .eq('is_published', true)
    .order('created_at', { ascending: false })
    .limit(3);

  // A brand new site has no batches yet. Rather than show an
  // empty box, show three examples clearly marked as examples.
  const isEmpty = !batches || batches.length === 0;
  const cards = isEmpty ? sampleCards() : batches.map(toCard);

  deck.innerHTML = cards.map((c, i) => cardHtml(c, i, isEmpty)).join('');
}

function toCard(b) {
  return {
    id: b.id,
    title: b.title,
    subject: b.subjects.name_en + ' · ' + b.subjects.grade_level,
    when: b.days + ' · ' + formatTime(b.start_time),
    where: b.is_online ? 'Online' : b.areas ? b.areas.name_en : 'In person',
    seats: Math.max(0, b.seat_limit - b.seats_taken),
    fee: b.monthly_fee,
    rating: b.tutor_profiles?.rating_count > 0 ? b.tutor_profiles.rating_avg : null,
  };
}

function sampleCards() {
  return [
    { title: 'HSC Physics — Morning', subject: 'Physics 1st Paper · HSC',
      when: 'Sun, Tue, Thu · 8:00 AM', where: 'Dhanmondi',
      seats: 4, fee: 2500, rating: 4.8 },
    { title: 'Class 9 Maths — Evening', subject: 'Mathematics · Class 9',
      when: 'Mon, Wed · 6:00 PM', where: 'Online',
      seats: 9, fee: 1500, rating: 4.6 },
    { title: 'ICT Crash Batch', subject: 'ICT · HSC',
      when: 'Fri, Sat · 10:00 AM', where: 'Uttara',
      seats: 2, fee: 1800, rating: null },
  ];
}

function cardHtml(c, index, isSample) {
  const rating = c.rating
    ? `<span class="fc-rating">&#9733; ${c.rating}</span>`
    : '<span class="fc-new">New</span>';

  const seats =
    c.seats <= 3
      ? `<span class="fc-seats hot">${c.seats} seats left</span>`
      : `<span class="fc-seats">${c.seats} seats left</span>`;

  const inner = `
    <div class="fc-top">
      <h3>${safe(c.title)}</h3>
      ${rating}
    </div>
    <p class="fc-sub">${safe(c.subject)}</p>
    <p class="fc-meta">${safe(c.when)}</p>
    <p class="fc-meta">${safe(c.where)} · ${seats}</p>
    <div class="fc-foot">
      <span class="fc-fee">${taka(c.fee)}<small>/month</small></span>
      <span class="fc-go">Join &rarr;</span>
    </div>`;

  // Real batches link to the batch page. Samples do not.
  return isSample
    ? `<div class="fcard fcard-${index + 1}" aria-hidden="true">
         <span class="fc-tag">Example</span>${inner}
       </div>`
    : `<a class="fcard fcard-${index + 1}" href="batch.html?id=${c.id}">${inner}</a>`;
}


// ============================================================
//  3. LIVE NUMBERS
// ============================================================
async function loadStats() {
  const strip = document.getElementById('stat-strip');

  // head:true means "just count, do not send the rows"
  const [tutors, batches, subjects, areas] = await Promise.all([
    supabase.from('tutor_profiles').select('id', { count: 'exact', head: true })
      .eq('status', 'approved'),
    supabase.from('batches').select('id', { count: 'exact', head: true })
      .eq('is_published', true),
    supabase.from('subjects').select('id', { count: 'exact', head: true }),
    supabase.from('areas').select('id', { count: 'exact', head: true }),
  ]);

  const items = [
    [tutors.count || 0, 'tutors'],
    [batches.count || 0, 'live batches'],
    [subjects.count || 0, 'subjects'],
    [areas.count || 0, 'areas'],
  ];

  strip.innerHTML = items
    .map(([n, label]) => `<div><b>${n}</b><span>${label}</span></div>`)
    .join('');
}


// ============================================================
//  THE 3D PART
//  The deck sits inside a box with CSS perspective. Moving the
//  mouse changes two CSS variables, and the CSS turns those
//  into a rotation. No animation library is used.
// ============================================================
function setupTilt() {
  const stage = document.getElementById('stage');
  const deck = document.getElementById('deck');
  if (!stage || !deck) return;

  // Phones have no mouse, and someone may have asked for less
  // movement, so in those cases the deck simply stays still.
  const stillPlease = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const noMouse = window.matchMedia('(hover: none)').matches;
  if (stillPlease || noMouse) return;

  stage.addEventListener('mousemove', (e) => {
    const box = stage.getBoundingClientRect();

    // Where is the pointer inside the box? -0.5 to +0.5
    const x = (e.clientX - box.left) / box.width - 0.5;
    const y = (e.clientY - box.top) / box.height - 0.5;

    deck.style.setProperty('--ry', (x * 18).toFixed(2) + 'deg');
    deck.style.setProperty('--rx', (-y * 12).toFixed(2) + 'deg');
  });

  stage.addEventListener('mouseleave', () => {
    deck.style.setProperty('--ry', '0deg');
    deck.style.setProperty('--rx', '0deg');
  });
}

// Sections slide up as they come into view.
function setupReveal() {
  const items = document.querySelectorAll('.reveal');

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    items.forEach((el) => el.classList.add('shown'));
    return;
  }

  const watcher = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('shown');
          watcher.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );

  items.forEach((el) => watcher.observe(el));
}

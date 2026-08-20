// ============================================================
//  HELLOSTUDENTS — landing page behaviour
//
//  Everything here is presentation only. No data, no login.
//
//    1. page entrance
//    2. floating nav (shrinks on scroll, opens on mobile)
//    3. hero parallax
//    4. scroll reveals
//    5. counting statistics
//    6. scattered tools merging together
//    7. progress bars filling
//    8. pricing toggle
//    9. light / dark switch
// ============================================================

import { supabase } from './supabase.js';
import { icon } from './icons.js';
import { toggleTheme } from './theme.js';

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const noMouse = window.matchMedia('(hover: none)').matches;


// ---- 1. page entrance --------------------------------------
requestAnimationFrame(() => {
  document.body.classList.add('ready');
  setTimeout(() => document.body.classList.add('on'), 60);
});


// ---- 2. floating nav ---------------------------------------
const bar = document.getElementById('topbar-inner');
const menuBtn = document.getElementById('menu-btn');
const mainNav = document.getElementById('main-nav');

function onScroll() {
  bar.classList.toggle('tight', window.scrollY > 40);
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

menuBtn.addEventListener('click', () => mainNav.classList.toggle('open'));

// close the mobile menu after tapping a link
mainNav.querySelectorAll('a').forEach((link) =>
  link.addEventListener('click', () => mainNav.classList.remove('open'))
);


// ---- 3. hero parallax --------------------------------------
// The dashboard turns very slightly towards the cursor, which
// is what makes it read as a real object with depth.
const stage = document.getElementById('hero-stage');
const scene = document.getElementById('hero-scene');

if (stage && scene && !still && !noMouse) {
  stage.addEventListener('mousemove', (e) => {
    const box = stage.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width - 0.5;
    const y = (e.clientY - box.top) / box.height - 0.5;

    scene.style.setProperty('--ry', (x * 9).toFixed(2) + 'deg');
    scene.style.setProperty('--rx', (7 - y * 7).toFixed(2) + 'deg');

    // Cards further forward move more, which sells the depth.
    scene.querySelectorAll('[data-depth]').forEach((card) => {
      const depth = Number(card.dataset.depth) / 100;
      card.style.setProperty(
        'transform',
        `translate3d(${(-x * depth * 46).toFixed(1)}px,` +
        `${(-y * depth * 34).toFixed(1)}px, 0)`
      );
    });
  });

  stage.addEventListener('mouseleave', () => {
    scene.style.setProperty('--ry', '0deg');
    scene.style.setProperty('--rx', '7deg');
    scene.querySelectorAll('[data-depth]').forEach((card) => {
      card.style.removeProperty('transform');
    });
  });
}


// ---- 3b. reading progress along the top --------------------
if (!still) {
  const progress = document.createElement('div');
  progress.id = 'scroll-progress';
  document.body.appendChild(progress);

  const updateProgress = () => {
    const scrollable = document.body.scrollHeight - window.innerHeight;
    progress.style.width =
      (scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0) + '%';
  };
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);
  updateProgress();
}


// ---- 4. scroll reveals -------------------------------------
const revealer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('shown');
      revealer.unobserve(entry.target);
    });
  },
  { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
);

document.querySelectorAll('.reveal, .stagger').forEach((el) => {
  if (still) el.classList.add('shown');
  else revealer.observe(el);
});


// ---- 5. real numbers, counted from the database -----------
//  These used to be invented ("500 teachers"). Showing made-up
//  figures as fact is not acceptable, so they are now counted
//  live. A new site shows small numbers, which is honest.
async function loadLiveStats() {
  const box = document.getElementById('live-stats');
  if (!box) return;

  // head:true means "just count, do not send the rows"
  const [tutors, batches, subjects, areas] = await Promise.all([
    supabase.from('tutor_profiles').select('id', { count: 'exact', head: true })
      .eq('status', 'approved'),
    supabase.from('batches').select('id', { count: 'exact', head: true })
      .eq('is_published', true),
    supabase.from('subjects').select('id', { count: 'exact', head: true }),
    supabase.from('areas').select('id', { count: 'exact', head: true }),
  ]);

  const values = [tutors.count, batches.count, subjects.count, areas.count];
  const cells = box.querySelectorAll('.pstat b');

  values.forEach((value, i) => {
    if (!cells[i]) return;
    countTo(cells[i], value || 0);
  });
}

// Counts up to a number when it appears, so it still feels alive.
function countTo(el, target) {
  if (still || target === 0) {
    el.textContent = target;
    return;
  }
  const runFor = 900;
  const startedAt = performance.now();

  function step(now) {
    const t = Math.min((now - startedAt) / runFor, 1);
    el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3)));
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

loadLiveStats();


// ---- 6. scattered tools merging ----------------------------
// The tools start thrown around the section. When the section
// comes into view they fly to the middle and become one card.
const merge = document.getElementById('merge');

if (merge) {
  const tools = merge.querySelectorAll('.tool');

  // put each tool where its data attributes say
  tools.forEach((tool) => {
    tool.style.setProperty(
      'transform',
      `translate(${tool.dataset.x}px, ${tool.dataset.y}px) rotate(${tool.dataset.r}deg)`
    );
  });

  if (still) {
    merge.classList.add('done');
  } else {
    const merger = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          // let people see the mess first, then pull it together
          setTimeout(() => merge.classList.add('done'), 900);
          merger.unobserve(entry.target);
        });
      },
      { threshold: 0.45 }
    );
    merger.observe(merge);
  }
}


// ---- 7. progress bars --------------------------------------
const bars = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.style.setProperty('width', entry.target.dataset.w + '%');
      bars.unobserve(entry.target);
    });
  },
  { threshold: 0.5 }
);

document.querySelectorAll('[data-w]').forEach((bar) => {
  if (still) bar.style.setProperty('width', bar.dataset.w + '%');
  else bars.observe(bar);
});


// ---- 8. pricing toggle -------------------------------------
const toggle = document.getElementById('toggle');
const price = document.getElementById('price');
const per = document.getElementById('per');

if (toggle) {
  toggle.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      toggle.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
      button.classList.add('on');

      const yearly = button.dataset.plan === 'year';
      price.textContent = yearly ? '7,670' : '799';
      per.textContent = yearly ? '/year' : '/month';
    });
  });
}


// ============================================================
//  9. LIGHT / DARK SWITCH
//
//  The landing page writes its own top bar inside index.html
//  instead of going through session.js, so the button has to
//  be filled in and wired up here rather than there.
// ============================================================
const themeBtn = document.getElementById('theme-btn');

if (themeBtn) {
  document.getElementById('sun-ico').innerHTML = icon('sun');
  document.getElementById('moon-ico').innerHTML = icon('moon');
  themeBtn.addEventListener('click', toggleTheme);
}

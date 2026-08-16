// ============================================================
//  Shared bits of interface used on many pages:
//  page headers, pop-up messages, confirm boxes, loading and
//  empty states, and the fade-in-on-scroll effect.
// ============================================================

import { icon } from './icons.js';

// ---- The coloured band at the top of every page ------------
//  Gives all pages the same look as the landing page.
//  <div id="page-hero"></div> goes in the HTML.
export function renderPageHero({ eyebrow, title, subtitle, actions = '' }) {
  const holder = document.getElementById('page-hero');
  if (!holder) return;

  holder.innerHTML = `
    <section class="page-hero">
      <div class="page-hero-inner">
        <div>
          ${eyebrow ? `<span class="eyebrow">${eyebrow}</span>` : ''}
          <h1>${title}</h1>
          ${subtitle ? `<p class="hero3d-sub">${subtitle}</p>` : ''}
        </div>
        ${actions ? `<div class="row">${actions}</div>` : ''}
      </div>
    </section>`;
}

// ---- Pop-up message in the top right corner ----------------
export function toast(message, kind = 'info') {
  let area = document.getElementById('toast-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'toast-area';
    document.body.appendChild(area);
  }

  const box = document.createElement('div');
  box.className = 'toast ' + kind;
  box.textContent = message;
  area.appendChild(box);

  setTimeout(() => box.remove(), 4000);
}

// ---- A yes/no box that matches the rest of the site --------
export function confirmBox(title, message, confirmLabel = 'Confirm') {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal">
        <h2>${title}</h2>
        <p class="lead mt-sm mb-md">${message}</p>
        <div class="row-end">
          <button type="button" class="btn btn-outline" data-no>Cancel</button>
          <button type="button" class="btn btn-danger" data-yes>${confirmLabel}</button>
        </div>
      </div>`;
    document.body.appendChild(back);

    const close = (answer) => {
      back.remove();
      resolve(answer);
    };

    back.querySelector('[data-yes]').addEventListener('click', () => close(true));
    back.querySelector('[data-no]').addEventListener('click', () => close(false));
    back.addEventListener('click', (e) => {
      if (e.target === back) close(false);
    });
  });
}

// ---- Grey loading blocks while data is being fetched -------
export function showLoading(element, count = 3) {
  element.innerHTML = Array.from({ length: count })
    .map(() => '<div class="skeleton"></div>')
    .join('');
}

// ---- A friendly "nothing here yet" box ---------------------
//  iconName comes from js/icons.js, for example 'book'.
export function showEmpty(element, iconName, title, message, button) {
  element.innerHTML = `
    <div class="empty">
      <div class="empty-ico">${icon(iconName, 'ico-lg')}</div>
      <h3>${title}</h3>
      <p class="muted">${message}</p>
      ${button ? `<a class="btn mt" href="${button.href}">${button.label}</a>` : ''}
    </div>`;
}

// ---- Turn a button into "Saving..." while work happens -----
export function busy(button, isBusy, busyLabel = 'Please wait...') {
  if (isBusy) {
    button.dataset.label = button.textContent;
    button.textContent = busyLabel;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

// ---- Fade sections in as they scroll into view -------------
//  Put class="reveal" on anything that should slide up.
export function setupReveal() {
  const items = document.querySelectorAll('.reveal');
  if (items.length === 0) return;

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
    { threshold: 0.12 }
  );

  items.forEach((el) => watcher.observe(el));
}

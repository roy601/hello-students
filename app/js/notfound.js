// ============================================================
//  404 PAGE
//  Shown whenever the address does not match a real page.
// ============================================================

import { renderTopbar } from './session.js';
import { icon } from './icons.js';

renderTopbar();

document.getElementById('nf-icon').innerHTML = icon('search', 'ico-lg');

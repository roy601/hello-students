// ============================================================
//  HELP CENTRE
//  A plain content page. It only needs the shared top bar and
//  the fade-in effect.
// ============================================================

import { renderTopbar } from './session.js';
import { renderPageHero, setupReveal } from './ui.js';

renderTopbar();

renderPageHero({
  eyebrow: 'Help centre',
  title: 'How HelloStudents works',
  subtitle: 'Answers for students and teachers, plus what we do with your information.',
});

setupReveal();

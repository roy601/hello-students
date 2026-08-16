// ============================================================
//  WATERMARK  —  so a leaked video can be traced back
//
//  Whoever is watching has their own name, the last 4 digits
//  of their phone, a short user code and the clock printed
//  over the video. If someone screen records the class and
//  the file spreads later, their own details are inside it.
//
//  WHAT IT STOPS
//    screen recording, phone camera pointed at the screen,
//    OBS capture, screenshots  -> all keep the label
//
//  WHAT IT DOES NOT STOP
//    Someone who knows how to open the browser tools can
//    delete the label and then record a clean copy. The code
//    below puts it straight back, and every view is written
//    to the class_views table anyway, so there is still a
//    list of who was watching at that moment.
//
//    Only burning the label into the video file itself, one
//    copy per student, is impossible to remove. That needs a
//    video server, which this project does not have.
// ============================================================

// Builds the line of text shown on the video.
export function makeLabel(profile) {
  const digits = String(profile.phone || '').replace(/\D/g, '');
  const last4 = digits ? ' · ' + digits.slice(-4) : '';
  const code = String(profile.id).slice(0, 8);
  return profile.full_name + last4 + ' · ' + code;
}

function randomBetween(low, high) {
  return low + Math.random() * (high - low);
}

// container must be a box with position:relative around the video.
// Returns a function that removes the watermark again.
export function attachWatermark(container, labelText) {
  if (!container) return () => {};

  let layer = null;

  function build() {
    layer = document.createElement('div');
    layer.className = 'wm-layer';

    // Two labels, not one. Cropping the video to cut off a
    // corner still leaves the other one in the picture.
    layer.innerHTML = '<span class="wm-tag"></span><span class="wm-tag"></span>';
    container.appendChild(layer);
  }

  function move() {
    const now = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const text = labelText + ' · ' + now;

    const tags = layer.querySelectorAll('.wm-tag');
    tags[0].textContent = text;
    tags[1].textContent = text;

    // Move every so often so it cannot be cropped out or
    // painted over in one fixed spot.
    tags[0].style.left = randomBetween(4, 45) + '%';
    tags[0].style.top = randomBetween(6, 38) + '%';
    tags[1].style.left = randomBetween(35, 72) + '%';
    tags[1].style.top = randomBetween(58, 88) + '%';
  }

  build();
  move();

  // Every 2 seconds: check the label is still there and still
  // visible. If someone removed or hid it, put it back.
  let ticks = 0;
  const timer = setInterval(() => {
    if (!container.contains(layer)) build();

    layer.style.display = 'block';
    layer.style.opacity = '1';
    layer.style.visibility = 'visible';

    ticks += 1;
    if (ticks % 10 === 0) move();      // new position every 20s
  }, 2000);

  return function stop() {
    clearInterval(timer);
    if (layer) layer.remove();
  };
}

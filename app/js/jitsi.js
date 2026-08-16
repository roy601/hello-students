// ============================================================
//  GROUP CLASS  (Jitsi Meet, embedded in our page)
//
//  Jitsi runs a real media server. Everyone sends their video
//  up once, and the server copies it to everyone else, so a
//  whole batch of 15 students works fine.
//
//  meet.jit.si is free to use, needs no account and no key.
//  We only tell it which room to open and what name to show.
// ============================================================

let api = null;

// The Jitsi script is loaded only when it is first needed,
// so the other pages of the site stay light.
function loadJitsiScript() {
  return new Promise((resolve, reject) => {
    if (window.JitsiMeetExternalAPI) {
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://meet.jit.si/external_api.js';
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error('Could not reach Jitsi. Check your internet.'));
    document.head.appendChild(script);
  });
}

// roomName must be hard to guess, or a stranger could walk in.
// Each batch has its own random room_code in the database.
export async function startJitsi({ holder, roomName, displayName, isTutor }) {
  await loadJitsiScript();

  stopJitsi();
  holder.innerHTML = '';

  api = new window.JitsiMeetExternalAPI('meet.jit.si', {
    roomName: roomName,
    parentNode: holder,
    width: '100%',
    height: '100%',
    userInfo: { displayName: displayName },

    configOverwrite: {
      prejoinPageEnabled: false,        // go straight in
      disableDeepLinking: true,         // stay in the browser
      startWithAudioMuted: !isTutor,    // students start muted
      startWithVideoMuted: !isTutor,
    },

    interfaceConfigOverwrite: {
      SHOW_JITSI_WATERMARK: false,
      SHOW_BRAND_WATERMARK: false,
      MOBILE_APP_PROMO: false,
      TOOLBAR_BUTTONS: [
        'microphone', 'camera', 'desktop', 'raisehand',
        'tileview', 'fullscreen', 'hangup',
      ],
    },
  });

  return api;
}

export function stopJitsi() {
  if (api) {
    api.dispose();
    api = null;
  }
}

// offscreen.js — plays the alarm sound. Runs inside the offscreen document
// because MV3 service workers cannot use the Audio API.

let audio = null;
let playsRemaining = 0;

function playAlarm(volume, src) {
  stopAlarm();
  audio = new Audio(src || chrome.runtime.getURL("alarm.wav"));
  audio.volume = volume ?? 1;
  playsRemaining = 3;

  audio.addEventListener("ended", () => {
    playsRemaining -= 1;
    if (playsRemaining > 0) {
      audio.currentTime = 0;
      audio.play();
    }
  });

  audio.play();
}

function stopAlarm() {
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
    audio = null;
  }
  playsRemaining = 0;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "PLAY_ALARM") {
    playAlarm(message.volume, message.src);
  } else if (message.type === "STOP_ALARM") {
    stopAlarm();
  }
});

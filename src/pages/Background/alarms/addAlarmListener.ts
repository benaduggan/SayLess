import { handleAlarm } from "./handleAlarm";

const alarmListener = (alarm: chrome.alarms.Alarm): void => {
  handleAlarm(alarm);
};

export const addAlarmListener = () => {
  if (!chrome.alarms.onAlarm.hasListener(alarmListener)) {
    chrome.alarms.onAlarm.addListener(alarmListener);
  }
};

// Check if the permission is granted
if (chrome.permissions) {
  chrome.permissions.contains({ permissions: ["alarms"] }, (result) => {
    if (result) {
      addAlarmListener();
    }
  });
}

import React, { useContext, useEffect, useState, useRef } from "react";

// Context
import { contentStateContext } from "../../context/ContentState";

const TimeSetter = () => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [hours, setHours] = useState<number | string>(
    Math.floor(contentState.alarmTime / 3600)
  );
  const [minutes, setMinutes] = useState<number | string>(
    Math.floor((contentState.alarmTime % 3600) / 60)
  );
  const [seconds, setSeconds] = useState<number | string>(
    Math.floor((contentState.alarmTime % 3600) % 60)
  );

  useEffect(() => {
    // Get from contentState
    setHours(Math.floor(contentState.alarmTime / 3600));
    setMinutes(Math.floor((contentState.alarmTime % 3600) / 60));
    setSeconds(Math.floor((contentState.alarmTime % 3600) % 60));
  }, []);

  useEffect(() => {
    if (!contentState.fromAlarm) return;
    // Set the time in seconds
    setHours(Math.floor(contentState.alarmTime / 3600));
    setMinutes(Math.floor((contentState.alarmTime % 3600) / 60));
    setSeconds(Math.floor((contentState.alarmTime % 3600) % 60));
  }, [contentState.alarmTime]);

  useEffect(() => {
    if (
      Number.isNaN(Number(hours)) ||
      Number.isNaN(Number(minutes)) ||
      Number.isNaN(Number(seconds))
    )
      return;
    if (hours === "" || minutes === "" || seconds === "") return;
    const hourValue = Number(hours);
    const minuteValue = Number(minutes);
    const secondValue = Number(seconds);
    setHours(hourValue);
    setMinutes(minuteValue);
    setSeconds(secondValue);
    // Set the time in seconds
    setContentState((prevContentState) => ({
      ...prevContentState,
      alarmTime: hourValue * 3600 + minuteValue * 60 + secondValue,
      fromAlarm: false,
      time: hourValue * 3600 + minuteValue * 60 + secondValue,
      timer: hourValue * 3600 + minuteValue * 60 + secondValue,
    }));
    chrome.storage.local.set({
      alarmTime: hourValue * 3600 + minuteValue * 60 + secondValue,
    });
  }, [hours, minutes, seconds]);

  useEffect(() => {
    if (
      Number.isNaN(Number(hours)) ||
      Number.isNaN(Number(minutes)) ||
      Number.isNaN(Number(seconds))
    )
      return;
    if (contentState.alarm) {
      setContentState((prevContentState) => ({
        ...prevContentState,
        time: Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds),
        timer: Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds),
        fromAlarm: false,
      }));
    } else {
      setContentState((prevContentState) => ({
        ...prevContentState,
        time: 0,
        timer: 0,
      }));
    }
  }, [contentState.alarm]);

  const handleHours = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Limit between 0 to 4, number only
    // Only 1 digit
    if (e.target.value.length > 1) {
      if (e.target.value[0] === "0") {
        e.target.value = String(parseFloat(e.target.value[1]));
      } else {
        return;
      }
    }
    if (Number.isNaN(Number(e.target.value))) {
      return;
    }
    if (Number(e.target.value) > 4) {
      e.target.value = "4";
    }
    setContentState((prevContentState) => ({
      ...prevContentState,
      fromAlarm: true,
    }));

    setHours(e.target.value);
  };

  const handleMinutes = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Limit between 0 to 59, number only
    if (Number.isNaN(Number(e.target.value))) {
      return;
    }
    if (Number(e.target.value) > 59) {
      e.target.value = "59";
    }
    setContentState((prevContentState) => ({
      ...prevContentState,
      fromAlarm: true,
    }));

    setMinutes(e.target.value);
  };

  const handleSeconds = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Limit between 0 to 59, number only
    if (Number.isNaN(Number(e.target.value))) {
      return;
    }
    if (Number(e.target.value) > 59) {
      e.target.value = "59";
    }
    setContentState((prevContentState) => ({
      ...prevContentState,
      fromAlarm: true,
    }));
    setSeconds(e.target.value);
  };

  return (
    <div className="time-set-parent">
      <div className="time-set-input">
        <input
          placeholder="0"
          onChange={handleMinutes}
          value={minutes}
          onBlur={(e) => {
            if (e.target.value === "") {
              e.target.value = "0";
              setMinutes(0);
            }
          }}
          onFocus={(e) => {
            e.target.select();
          }}
        />
        <span>M</span>
      </div>
      <div className="time-set-input">
        <input
          placeholder="0"
          onChange={handleSeconds}
          value={seconds}
          onBlur={(e) => {
            if (e.target.value === "") {
              e.target.value = "0";
              setSeconds(0);
            }
          }}
          onFocus={(e) => {
            e.target.select();
          }}
        />
        <span>S</span>
      </div>
    </div>
  );
};

export default TimeSetter;

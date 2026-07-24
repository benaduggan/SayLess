import React, { useEffect, useContext, useState, useRef } from "react";

import Dropdown from "../components/Dropdown";
import Switch from "../components/Switch";
import RegionDimensions from "../components/RegionDimensions";
import Settings from "./Settings";
import { contentStateContext } from "../../context/ContentState";
import { CameraOffBlue, MicOffBlue } from "../../images/popup/images";

import BackgroundEffects from "../components/BackgroundEffects";

import { AlertIcon, TimeIcon } from "../../toolbar/components/SVG";

type PermissionMediaType = "camera" | "microphone";

const RecordingType = (props: { shadowRef: React.RefObject<HTMLElement | null> }) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const [cropActive, setCropActive] = useState(false);
  const [time, setTime] = useState("0:00");
  const [URL] = useState(chrome.runtime.getURL("setup.html"));
  const [URL2] = useState(chrome.runtime.getURL("permissions.html"));

  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  // Opens the right permissions modal based on why access is blocked.
  // When the hosting page's Permissions-Policy header disallows camera or
  // microphone, the usual "click the camera icon in the address bar" advice
  // is wrong (the site is the blocker, not the browser). Route to a
  // site-specific modal in that case.
  const openPermissionsModal = (mediaTypes: PermissionMediaType[]) => {
    if (typeof contentState.openModal !== "function") return;
    const isBlockedBySite = mediaTypes.some(
      (type: PermissionMediaType) =>
        contentState[`site${type[0].toUpperCase()}${type.slice(1)}PermissionBlocked`],
    );
    if (isBlockedBySite) {
      contentState.openModal(
        chrome.i18n.getMessage("sitePermissionsBlockedTitle"),
        chrome.i18n.getMessage("sitePermissionsBlockedDescription"),
        null,
        chrome.i18n.getMessage("permissionsModalDismiss"),
        () => {},
        () => {},
        null,
        null,
        null,
        true,
        false,
      );
      return;
    }
    const hasDeniedPermission = mediaTypes.some(
      (type: PermissionMediaType) => contentState[`${type}PermissionState`] === "denied",
    );
    const requestPermissions = () => {
      if (hasDeniedPermission) {
        chrome.runtime.sendMessage({
          type: "extension-media-permissions",
        });
        return;
      }
      const requestStarted =
        typeof contentState.requestMediaPermissions === "function" &&
        contentState.requestMediaPermissions(mediaTypes);
      if (!requestStarted) {
        chrome.runtime.sendMessage({
          type: "extension-media-permissions",
        });
      }
    };

    contentState.openModal(
      chrome.i18n.getMessage("permissionsModalTitle"),
      chrome.i18n.getMessage("permissionsModalDescription"),
      chrome.i18n.getMessage("permissionsModalReview"),
      chrome.i18n.getMessage("permissionsModalDismiss"),
      requestPermissions,
      () => {},
      chrome.runtime.getURL("assets/helper/permissions.webp"),
      chrome.i18n.getMessage("learnMoreDot"),
      URL2,
      true,
      false,
    );
  };

  useEffect(() => {
    // Convert seconds to mm:ss
    let minutes = Math.floor(contentState.alarmTime / 60);
    let seconds: number | string = contentState.alarmTime - minutes * 60;
    if (seconds < 10) {
      seconds = "0" + seconds;
    }
    setTime(minutes + ":" + seconds);
  }, []);

  useEffect(() => {
    // Convert seconds to mm:ss
    let minutes = Math.floor(contentState.alarmTime / 60);
    let seconds: number | string = contentState.alarmTime - minutes * 60;
    if (seconds < 10) {
      seconds = "0" + seconds;
    }
    setTime(minutes + ":" + seconds);
  }, [contentState.alarmTime]);

  // Start recording
  const startStreaming = () => {
    contentState.startStreaming();
  };

  useEffect(() => {
    // Check if CropTarget is null
    if (typeof CropTarget === "undefined") {
      setCropActive(false);
      setContentState((prevContentState) => ({
        ...prevContentState,
        customRegion: false,
      }));
    } else {
      setCropActive(true);
    }
  }, []);

  useEffect(() => {
    if (contentState.recording) {
      setContentState((prevContentState) => ({
        ...prevContentState,
        pendingRecording: false,
      }));
    }
  }, [contentState.recording]);

  return (
    <div>
      {contentState.updateChrome && (
        <div className="popup-warning">
          <div className="popup-warning-left">
            <AlertIcon />
          </div>
          <div className="popup-warning-middle">
            <div className="popup-warning-title">
              {chrome.i18n.getMessage("customAreaRecordingDisabledTitle")}
            </div>
            <div className="popup-warning-description">
              {chrome.i18n.getMessage("customAreaRecordingDisabledDescription")}
            </div>
          </div>
          <div className="popup-warning-right">
            <a href={URL} target="_blank">
              {chrome.i18n.getMessage("customAreaRecordingDisabledAction")}
            </a>
          </div>
        </div>
      )}
      {!cropActive && contentState.recordingType === "region" && !contentState.offline && (
        <div className="popup-warning">
          <div className="popup-warning-left">
            <AlertIcon />
          </div>
          <div className="popup-warning-middle">
            <div className="popup-warning-title">
              {chrome.i18n.getMessage("customAreaRecordingDisabledTitle")}
            </div>
            <div className="popup-warning-description">
              {chrome.i18n.getMessage("customAreaRecordingDisabledDescription")}
            </div>
          </div>
          <div className="popup-warning-right">
            <a href={URL} target="_blank">
              {chrome.i18n.getMessage("customAreaRecordingDisabledAction")}
            </a>
          </div>
        </div>
      )}
      {!contentState.cameraPermission && (
        <button className="permission-button" onClick={() => openPermissionsModal(["camera"])}>
          <img src={CameraOffBlue} />
          <span>{chrome.i18n.getMessage("allowCameraAccessButton")}</span>
        </button>
      )}
      {contentState.cameraPermission && <Dropdown type="camera" shadowRef={props.shadowRef} />}
      {contentState.cameraPermission &&
        contentState.defaultVideoInput != "none" &&
        contentState.cameraActive && (
          <div>
            <Switch
              label={chrome.i18n.getMessage("flipCameraLabel")}
              name="flip-camera"
              value="cameraFlipped"
            />
            <div style={{ pointerEvents: "auto" }}>
              <Switch
                label={chrome.i18n.getMessage("backgroundEffectsLabel")}
                name="background-effects-active"
                value="backgroundEffectsActive"
              />
            </div>

            {contentState.backgroundEffectsActive && <BackgroundEffects />}
          </div>
        )}

      {!contentState.microphonePermission && (
        <button className="permission-button" onClick={() => openPermissionsModal(["microphone"])}>
          <img src={MicOffBlue} />
          <span>{chrome.i18n.getMessage("allowMicrophoneAccessButton")}</span>
        </button>
      )}
      {contentState.microphonePermission && <Dropdown type="mic" shadowRef={props.shadowRef} />}
      {((contentState.microphonePermission &&
        contentState.defaultAudioInput != "none" &&
        contentState.micActive) ||
        (contentState.microphonePermission && contentState.pushToTalk)) && (
        <div>
          <iframe
            className="screenity-iframe"
            style={{
              width: "100%",
              height: "30px",
              zIndex: 999999,
              position: "relative",
            }}
            allow="camera; microphone"
            src={chrome.runtime.getURL("waveform.html")}
          ></iframe>
          <Switch
            label={
              isMac
                ? chrome.i18n.getMessage("pushToTalkLabel") + " (⌥⇧U)"
                : chrome.i18n.getMessage("pushToTalkLabel") + " (Alt⇧U)"
            }
            name="pushToTalk"
            value="pushToTalk"
          />
        </div>
      )}
      {contentState.recordingType === "region" && cropActive && (
        <div>
          <div className="popup-content-divider"></div>
          <Switch
            label={chrome.i18n.getMessage("customAreaLabel")}
            name="customRegion"
            value="customRegion"
          />
          {contentState.customRegion && <RegionDimensions />}
        </div>
      )}
      <button
        role="button"
        className="main-button recording-button"
        ref={buttonRef}
        tabIndex={0}
        onClick={startStreaming}
        disabled={
          contentState.pendingRecording ||
          ((!contentState.cameraPermission || !contentState.cameraActive) &&
            contentState.recordingType === "camera")
        }
      >
        {contentState.alarm && contentState.alarmTime > 0 && (
          <div className="alarm-time-button">
            <TimeIcon />
            {time}
          </div>
        )}
        <span className="main-button-label">
          {contentState.pendingRecording
            ? chrome.i18n.getMessage("recordButtonInProgressLabel")
            : (!contentState.cameraPermission || !contentState.cameraActive) &&
                contentState.recordingType === "camera"
              ? chrome.i18n.getMessage("recordButtonNoCameraLabel")
              : contentState.multiMode && contentState.multiSceneCount > 0
                ? chrome.i18n.getMessage("recordButtonMultiLabel")
                : chrome.i18n.getMessage("recordButtonLabel")}
        </span>
        <span className="main-button-shortcut">{contentState.recordingShortcut}</span>
      </button>
      <Settings />
    </div>
  );
};

export default RecordingType;

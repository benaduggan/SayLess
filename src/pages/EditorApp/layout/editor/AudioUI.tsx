import { useState, useContext, useRef } from "react";
import type { ChangeEvent } from "react";
import styles from "../../styles/player/_RightPanel.module.scss";

import * as Slider from "@radix-ui/react-slider";

const URL = chrome.runtime.getURL("assets/");

import { ReactSVG } from "react-svg";

import { useEditorContent } from "../../context/ContentState";
import Switch from "../../components/editor/Switch";
import { EdlContext } from "../../context/EdlContext";

const AudioUI = () => {
  const [contentState, setContentState] = useEditorContent();
  const edlCtx = useContext(EdlContext);
  const [audio, setAudio] = useState<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAudio = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size === 0) {
      return;
    }

    setAudio(file);
    setContentState((prev) => ({
      ...prev,
      pendingAudio: file,
      removeProjectAudio: false,
      editErrorType: null,
    }));
  };

  const handleVolume = (e: ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    if (value < 0) {
      return;
    }
    if (value > 100) {
      return;
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      volume: value / 100,
    }));
  };

  return (
    <div>
      {(contentState.editErrorType === "audio-too-large" ||
        contentState.editErrorType === "audio-unsupported") && (
        <div className={styles.alert}>
          <div className={styles.buttonLeft}>
            <ReactSVG src={URL + "editor/icons/alert.svg"} />
          </div>
          <div className={styles.buttonMiddle}>
            <div className={styles.buttonTitle}>
              {contentState.editErrorType === "audio-too-large"
                ? chrome.i18n.getMessage("editAudioTooLargeTitle")
                : "Audio file could not be decoded"}
            </div>
            <div className={styles.buttonDescription}>
              {contentState.editErrorType === "audio-too-large"
                ? chrome.i18n.getMessage("editAudioTooLargeDescription")
                : "Choose a valid WAV, M4A, MP3, or other audio file supported by this browser."}
            </div>
          </div>
          <div
            className={styles.buttonRight}
            onClick={() =>
              setContentState((prev) => ({ ...prev, editErrorType: null }))
            }
          >
            {chrome.i18n.getMessage("permissionsModalDismiss")}
          </div>
        </div>
      )}
      {edlCtx?.audioAssetStatus === "missing" && (
        <div className={styles.alert}>
          <div className={styles.buttonLeft}>
            <ReactSVG src={URL + "editor/icons/alert.svg"} />
          </div>
          <div className={styles.buttonMiddle}>
            <div className={styles.buttonTitle}>Project audio needs relinking</div>
            <div className={styles.buttonDescription}>
              Choose the original audio file again. Its portable project reference was preserved.
            </div>
          </div>
        </div>
      )}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Audio upload</div>
        <input
          data-testid="project-audio-file-input"
          type="file"
          accept="audio/*"
          onChange={handleAudio}
          style={{ display: "none" }}
          ref={inputRef}
        />
        {!audio &&
          (!edlCtx?.audioTrack ||
            contentState.removeProjectAudio ||
            edlCtx.audioAssetStatus === "missing") && (
          <div
            className={styles.uploadArea}
            onClick={() => inputRef.current?.click()}
          >
            <ReactSVG src={URL + "editor/icons/upload.svg"} />
            <div className={styles.uploadDetails}>
              <div className={styles.uploadText}>
                {chrome.i18n.getMessage("sandboxAudioDragAndDrop")}
              </div>
              <div className={styles.uploadDescription}>
                {chrome.i18n.getMessage("sandboxAudioOrBrowse")}
              </div>
            </div>
          </div>
        )}
        {(audio || edlCtx?.audioTrack) && !contentState.removeProjectAudio && (
          <div className={styles.audioDetails} data-testid="project-audio-details">
            <div className={styles.audioDetailsLeft}>
              <ReactSVG src={URL + "editor/icons/attachment.svg"} />
            </div>
            <div className={styles.audioDetailsMiddle}>
              <span>{audio?.name || edlCtx?.audioTrack?.fileName}</span>
            </div>
            <div className={styles.audioDetailsRight}>
              <ReactSVG
                src={URL + "editor/icons/cross.svg"}
                onClick={() => {
                  setAudio(null);
                  setContentState((prevContentState) => ({
                    ...prevContentState,
                    pendingAudio: null,
                    removeProjectAudio: true,
                  }));
                  if (inputRef.current) inputRef.current.value = "";
                }}
              />
            </div>
          </div>
        )}
      </div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>
          {chrome.i18n.getMessage("sandboxAudioSettingsTitle")}
        </div>
        <div className={styles.inputs}>
          <div className={`${styles.input} ${styles.inputVolume}`}>
            <div className={styles.inputTitle}>
              {chrome.i18n.getMessage("sandboxAudioVolumeLabel")}
            </div>
            <input
              type="text"
              className="input"
              onChange={(e) => handleVolume(e)}
              value={Math.round((Number(contentState.volume) || 0) * 100)}
              onBlur={(e) => {
                if (e.target.value === "") {
                  setContentState((prevContentState) => ({
                    ...prevContentState,
                    volume: 0,
                  }));
                }
              }}
            />
            <span>%</span>
          </div>
          <Slider.Root
            className={styles.SliderRoot}
            max={100}
            step={1}
            onValueChange={(newValue) => {
              setContentState((prevContentState) => ({
                ...prevContentState,
                volume: Math.round(newValue[0] || 0) / 100,
              }));
            }}
            value={[(Number(contentState.volume) || 0) * 100]}
          >
            <Slider.Track className={styles.SliderTrack}>
              <Slider.Range className={styles.SliderRange} />
            </Slider.Track>
            <Slider.Thumb className={styles.SliderThumb} aria-label="Volume" />
          </Slider.Root>
        </div>
        <Switch />
      </div>
    </div>
  );
};

export default AudioUI;

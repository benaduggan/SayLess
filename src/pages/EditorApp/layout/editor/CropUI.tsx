import { useContext } from "react";
import type { ChangeEvent } from "react";
import styles from "../../styles/player/_RightPanel.module.css";

import { ReactSVG } from "react-svg";

const URL = chrome.runtime.getURL("assets/");

import { useEditorContent } from "../../context/ContentState";

const CropUI = () => {
  const [contentState, setContentState] = useEditorContent();

  const handleWidth = (e: ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    if (value < 0) {
      return;
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      width: value,
      cropPreset: "none",
      fromCropper: false,
    }));
  };

  const handleHeight = (e: ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    if (value < 0) {
      return;
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      height: value,
      cropPreset: "none",
      fromCropper: false,
    }));
  };

  const handleTop = (e: ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    if (value < 0) {
      return;
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      top: value,
      fromCropper: false,
    }));
  };

  const handleLeft = (e: ChangeEvent<HTMLInputElement>) => {
    const value = Number(e.target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    if (value < 0) {
      return;
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      left: value,
      fromCropper: false,
    }));
  };

  return (
    <div>
      {/*
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Dimensions</div>
        <div className={styles.inputSection}>
          <div className={styles.inputSectionTitle}>Preset</div>
          <Dropdown />
        </div>
      </div>
							*/}

      <div className={styles.alert}>
        <div className={styles.buttonLeft}>
          <ReactSVG src={URL + "editor/icons/alert.svg"} />
        </div>
        <div className={styles.buttonMiddle}>
          <div className={styles.buttonTitle}>{chrome.i18n.getMessage("croppingInfoTitle")}</div>
          <div className={styles.buttonDescription}>
            {chrome.i18n.getMessage("videoProcessingLabelDescription")}
          </div>
        </div>
        <div
          className={styles.buttonRight}
          onClick={() => {
            chrome.runtime.sendMessage({ type: "open-processing-info" });
          }}
        >
          {chrome.i18n.getMessage("learnMoreLabel")}
        </div>
      </div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>{chrome.i18n.getMessage("sandboxCropTitle")}</div>
        <div className={styles.inputs}>
          <div className={styles.input}>
            <div className={styles.inputTitle}>{chrome.i18n.getMessage("widthLabel")}</div>
            <input
              data-testid="project-crop-width"
              type="text"
              className="input"
              onChange={(e) => handleWidth(e)}
              onBlur={(e) => {
                if (e.target.value === "") {
                  setContentState((prevContentState) => ({
                    ...prevContentState,
                    width: 0,
                  }));
                }
              }}
              value={String(contentState.width ?? "")}
            />
            <span>px</span>
          </div>
          <div className={styles.input}>
            <div className={styles.inputTitle}>{chrome.i18n.getMessage("heightLabel")}</div>
            <input
              data-testid="project-crop-height"
              type="text"
              className="input"
              onChange={(e) => handleHeight(e)}
              value={String(contentState.height ?? "")}
              onBlur={(e) => {
                if (e.target.value === "") {
                  setContentState((prevContentState) => ({
                    ...prevContentState,
                    height: 0,
                  }));
                }
              }}
            />
            <span>px</span>
          </div>
        </div>
        <div className={styles.inputs}>
          <div className={styles.input}>
            <div className={styles.inputTitle}>{chrome.i18n.getMessage("leftLabel")}</div>
            <input
              data-testid="project-crop-left"
              type="text"
              className="input"
              onChange={(e) => handleLeft(e)}
              onBlur={(e) => {
                if (e.target.value === "") {
                  setContentState((prevContentState) => ({
                    ...prevContentState,
                    left: 0,
                  }));
                }
              }}
              value={String(contentState.left ?? "")}
            />
            <span>px</span>
          </div>
          <div className={styles.input}>
            <div className={styles.inputTitle}>{chrome.i18n.getMessage("topLabel")}</div>
            <input
              data-testid="project-crop-top"
              type="text"
              className="input"
              onChange={(e) => handleTop(e)}
              onBlur={(e) => {
                if (e.target.value === "") {
                  setContentState((prevContentState) => ({
                    ...prevContentState,
                    top: 0,
                  }));
                }
              }}
              value={String(contentState.top ?? "")}
            />
            <span>px</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CropUI;

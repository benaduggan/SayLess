import { useContext } from "react";
import styles from "../../styles/edit/_EditorNav.module.scss";
import { useEditorContent } from "../../context/ContentState";
import { EdlContext } from "../../context/EdlContext";

const URL = chrome.runtime.getURL("assets/");

const AudioNav = () => {
  const [contentState, setContentState] = useEditorContent();
  const edlCtx = useContext(EdlContext);

  const handleCancel = () => {
    setContentState((prev) => ({
      ...prev,
      mode: "player",
      start: 0,
      end: 1,
      pendingAudio: null,
      removeProjectAudio: false,
    }));
  };

  const handleRevert = () => {
    void edlCtx?.removeProjectAudio();
    setContentState((prev) => ({
      ...prev,
      start: 0,
      end: 1,
      pendingAudio: null,
      removeProjectAudio: false,
    }));
    contentState.openToast?.(chrome.i18n.getMessage("sandboxToastReverted"));
  };

  const saveChanges = async () => {
    const { pendingAudio, volume, loopAudio, removeProjectAudio } = contentState;

    setContentState((prev) => ({
      ...prev,
      isFfmpegRunning: true,
      processingProgress: 0,
    }));

    try {
      if (removeProjectAudio) {
        await edlCtx?.removeProjectAudio();
      } else if (pendingAudio) {
        await edlCtx?.saveProjectAudio(pendingAudio, {
          fileName: pendingAudio instanceof File ? pendingAudio.name : "Project audio",
          volume,
          mode: contentState.replaceAudio ? "replace" : "mix",
          loop: loopAudio,
        });
      } else if (edlCtx?.audioTrack) {
        edlCtx.updateProjectAudio({
          volume,
          mode: contentState.replaceAudio ? "replace" : "mix",
          loop: loopAudio,
        });
      }
      setContentState((prev) => ({
        ...prev,
        mode: "player",
        pendingAudio: null,
        removeProjectAudio: false,
        isFfmpegRunning: false,
        processingProgress: 0,
        hasBeenEdited: true,
      }));
    } catch (error) {
      console.warn("[SayLess] Failed to save project audio", error);
      setContentState((prev) => ({
        ...prev,
        isFfmpegRunning: false,
        editErrorType: String(error).includes("too-large")
          ? "audio-too-large"
          : String(error).includes("project-audio-decode") ||
              String(error).includes("project-audio-invalid")
            ? "audio-unsupported"
            : "failed",
      }));
      return;
    }
    contentState.openToast?.(chrome.i18n.getMessage("sandboxToastSaved"));
  };

  return (
    <div className={styles.editorNav}>
      <div className={styles.navWrap}>
        <div
          className={styles.editorNavLeft}
          onClick={() => chrome.runtime.sendMessage({ type: "open-home" })}
        >
          <img src={URL + "editor/logo.svg"} alt="Logo" />
        </div>

        <div className={styles.editorNavCenter}>
          <div className={styles.editorNavTitle}>
            {chrome.i18n.getMessage("sandboxEditorMainTitle")}{" "}
            <span className={styles.beta}>BETA</span>
          </div>
        </div>

        <div className={styles.editorNavRight}>
          <button
            data-testid="project-audio-cancel"
            className="button simpleButton blackButton"
            onClick={handleCancel}
          >
            {chrome.i18n.getMessage("sandboxEditorCancelButton")}
          </button>

          <button
            data-testid="project-audio-revert"
            className="button secondaryButton"
            onClick={handleRevert}
            disabled={Boolean(contentState.isFfmpegRunning)}
          >
            {chrome.i18n.getMessage("sandboxEditorRevertButton")}
          </button>

          <button
            data-testid="project-audio-save"
            className="button primaryButton"
            onClick={saveChanges}
            disabled={Boolean(contentState.isFfmpegRunning)}
          >
            {contentState.isFfmpegRunning ? (
              Number(contentState.processingProgress) > 0 ? (
                <>
                  {chrome.i18n.getMessage("sandboxEditorSaveProgressButton") ||
                    "Saving"}{" "}
                  {Math.round(Number(contentState.processingProgress) || 0)}%
                </>
              ) : (
                chrome.i18n.getMessage("sandboxEditorSaveProgressButton") ||
                "Saving..."
              )
            ) : (
              chrome.i18n.getMessage("sandboxEditorSaveButton") ||
              "Save changes"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AudioNav;

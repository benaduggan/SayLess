import { useContext } from "react";
import styles from "../../styles/edit/_EditorNav.module.css";
import { useEditorContent } from "../../context/ContentState";
import { EdlContext } from "../../context/EdlContext";
import { cropRegionFromPixels, cropRegionToPixels } from "../../../../edl/crop";

const URL = chrome.runtime.getURL("assets/");

const CropNav = () => {
  const [contentState, setContentState] = useEditorContent();
  const edlCtx = useContext(EdlContext);

  const sourceWidth = contentState.prevWidth || contentState.width;
  const sourceHeight = contentState.prevHeight || contentState.height;

  const handleCancel = () => {
    setContentState((prevContentState) => ({
      ...prevContentState,
      mode: "player",
      start: 0,
      end: 1,
      width: contentState.prevWidth,
      height: contentState.prevHeight,
      left: 0,
      top: 0,
      fromCropper: false,
    }));
  };

  const handleRevert = () => {
    const previousCrop = edlCtx?.crop || null;
    edlCtx?.updateCrop(null);
    setContentState((prevContentState) => ({
      ...prevContentState,
      start: 0,
      end: 1,
      width: sourceWidth,
      height: sourceHeight,
      left: 0,
      top: 0,
      fromCropper: false,
    }));
    contentState.openToast?.(chrome.i18n.getMessage("sandboxToastReverted"), () => {
      edlCtx?.updateCrop(previousCrop);
      const restored = cropRegionToPixels(previousCrop, sourceWidth, sourceHeight);
      setContentState((p) => ({
        ...p,
        left: restored.x,
        top: restored.y,
        width: restored.width,
        height: restored.height,
      }));
    });
  };

  const saveChanges = async () => {
    const previousCrop = edlCtx?.crop || null;
    const nextCrop = cropRegionFromPixels(
      {
        x: contentState.left,
        y: contentState.top,
        width: contentState.width,
        height: contentState.height,
      },
      sourceWidth,
      sourceHeight,
    );
    setContentState((prev) => ({
      ...prev,
      isFfmpegRunning: true,
      processingProgress: 0,
      editErrorType: null,
    }));
    try {
      await edlCtx?.saveProjectCrop(nextCrop);
      setContentState((prev) => ({
        ...prev,
        mode: "player",
        width: sourceWidth,
        height: sourceHeight,
        left: 0,
        top: 0,
        fromCropper: false,
        hasBeenEdited: true,
        isFfmpegRunning: false,
      }));
      contentState.openToast?.(chrome.i18n.getMessage("sandboxToastSaved"), () =>
        edlCtx?.updateCrop(previousCrop),
      );
    } catch (error) {
      console.warn("[SayLess] Failed to save project crop", error);
      setContentState((prev) => ({
        ...prev,
        isFfmpegRunning: false,
        editErrorType: "failed",
      }));
    }
  };

  return (
    <div className={styles.editorNav}>
      <div className={styles.navWrap}>
        <div
          className={styles.editorNavLeft}
          onClick={() => {
            chrome.runtime.sendMessage({ type: "open-home" });
          }}
        >
          <img src={URL + "editor/logo.svg"} alt="Logo" />
        </div>
        <div className={styles.editorNavCenter}>
          <div className={styles.editorNavTitle}>
            {chrome.i18n.getMessage("sandboxEditorMainTitle") + " "}{" "}
            <span className={styles.beta}>BETA</span>
          </div>
        </div>
        <div className={styles.editorNavRight}>
          <button
            data-testid="project-crop-cancel"
            className="button simpleButton blackButton"
            onClick={handleCancel}
          >
            {chrome.i18n.getMessage("sandboxEditorCancelButton")}
          </button>
          <button
            data-testid="project-crop-revert"
            className="button secondaryButton"
            onClick={handleRevert}
            disabled={Boolean(contentState.isFfmpegRunning)}
          >
            {chrome.i18n.getMessage("sandboxEditorRevertButton")}
          </button>
          <button
            data-testid="project-crop-save"
            className="button primaryButton"
            onClick={saveChanges}
            disabled={Boolean(contentState.isFfmpegRunning)}
          >
            {contentState.isFfmpegRunning ? (
              Number(contentState.processingProgress) > 0 ? (
                <>
                  {chrome.i18n.getMessage("sandboxEditorSaveProgressButton") || "Saving"}{" "}
                  {Math.round(Number(contentState.processingProgress) || 0)}%
                </>
              ) : (
                chrome.i18n.getMessage("sandboxEditorSaveProgressButton") || "Saving..."
              )
            ) : (
              chrome.i18n.getMessage("sandboxEditorSaveButton") || "Save changes"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CropNav;

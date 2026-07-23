import { useContext } from "react";
import * as S from "@radix-ui/react-switch";

// Styles
import styles from "../../styles/edit/_Switch.module.scss";

// Context
import { useEditorContent } from "../../context/ContentState";

const Switch = () => {
  const [contentState, setContentState] = useEditorContent();

  return (
    <form>
      <div className={styles.SwitchRow}>
        <label
          className={styles.Label}
          htmlFor="replaceAudio"
          style={{ paddingRight: 15 }}
        >
          {chrome.i18n.getMessage("replaceAudioEditor")}
        </label>
        <S.Root
          id="replaceAudio"
          data-testid="project-audio-replace"
          className={styles.SwitchRoot}
          checked={Boolean(contentState.replaceAudio)}
          onCheckedChange={(checked) => {
            setContentState((prevContentState) => ({
              ...prevContentState,
              replaceAudio: checked,
            }));
          }}
        >
          <S.Thumb className={styles.SwitchThumb} />
        </S.Root>
      </div>
      <div className={styles.SwitchRow}>
        <label
          className={styles.Label}
          htmlFor="loopAudio"
          style={{ paddingRight: 15 }}
        >
          Loop added audio
        </label>
        <S.Root
          id="loopAudio"
          data-testid="project-audio-loop"
          className={styles.SwitchRoot}
          checked={Boolean(contentState.loopAudio)}
          onCheckedChange={(checked) => {
            setContentState((prevContentState) => ({
              ...prevContentState,
              loopAudio: checked,
            }));
          }}
        >
          <S.Thumb className={styles.SwitchThumb} />
        </S.Root>
      </div>
    </form>
  );
};

export default Switch;

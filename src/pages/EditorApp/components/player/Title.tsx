import { useContext, useState, useEffect, useRef } from "react";
import type { ChangeEvent } from "react";

// Styles
import styles from "../../styles/player/_Title.module.css";
const URL = chrome.runtime.getURL("assets/");

// Icon
import { ReactSVG } from "react-svg";

// Context
import { useEditorContent } from "../../context/ContentState";

const Title = () => {
  const [contentState, setContentState] = useEditorContent();
  const inputRef = useRef<HTMLInputElement>(null);
  const contentTitle = String(contentState.title || "");
  // Show the video title, as a heading by default (multiline), on click show a text input to edit the title
  const [showTitle, setShowTitle] = useState(true);
  const [title, setTitle] = useState(contentTitle);
  const [displayTitle, setDisplayTitle] = useState(contentTitle);

  useEffect(() => {
    setTitle(contentTitle);
    if (contentTitle.length > 80) {
      setDisplayTitle(contentTitle.slice(0, 80) + "...");
    } else {
      setDisplayTitle(contentTitle);
    }
  }, [contentState.title]);

  const handleTitleChange = (e: ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
  };

  const handleTitleClick = () => {
    setShowTitle(false);
  };

  const handleTitleBlur = () => {
    setShowTitle(true);
    setContentState((prevState) => ({
      ...prevState,
      title: title,
    }));
  };

  useEffect(() => {
    if (!showTitle) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [showTitle]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        setShowTitle(true);
        setContentState((prevState) => ({
          ...prevState,
          title: title,
        }));
      } else if (e.key === "Escape") {
        setShowTitle(true);
        setTitle(contentTitle);
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [title]);

  return (
    <div className={styles.TitleParent}>
      <div className={styles.TitleWrap}>
        {showTitle ? (
          <>
            <h1 onClick={handleTitleClick}>
              {displayTitle}{" "}
              <ReactSVG
                src={URL + "editor/icons/pencil.svg"}
                className={styles.pencil}
                style={{ display: "inline-block" }}
              />
            </h1>
          </>
        ) : (
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            onBlur={handleTitleBlur}
            ref={inputRef}
          />
        )}
      </div>
    </div>
  );
};

export default Title;

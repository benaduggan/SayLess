import React, { useContext, useEffect } from "react";
import EditorNav from "./EditorNav";
import VideoPlayer from "../../components/editor/VideoPlayer";
import TrimUI from "./TrimUI";
import { useEditorContent } from "../../context/ContentState";
import TranscriptPanel from "../../components/editor/TranscriptPanel";

const Editor = () => {
  const [contentState, setContentState] = useEditorContent();

  const handleSeek = (time: number, updatePlayerTime: boolean) => {
    setContentState((previous) => ({
      ...previous,
      updatePlayerTime,
      time,
    }));
  };

  useEffect(() => {
    setContentState((previous) => ({
      ...previous,
      history: [{}],
      redoHistory: [],
    }));
    contentState.addToHistory();
  }, []);

  return (
    <div
      className="saylessEditor h-dvh overflow-hidden bg-sayless-canvas"
      data-testid="editor-layout"
    >
      <EditorNav />
      <main className="saylessEditor__workspace min-h-0 min-w-0 overflow-hidden">
        <section className="saylessEditor__mediaColumn min-h-0 min-w-0 overflow-hidden">
          <VideoPlayer onSeek={handleSeek} />
          <TrimUI />
        </section>
        <aside className="saylessEditor__transcriptPanel">
          <TranscriptPanel variant="inline" />
        </aside>
      </main>
    </div>
  );
};

export default Editor;

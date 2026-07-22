import React, { useContext, useEffect } from "react";
import EditorNav from "./EditorNav";
import VideoPlayer from "../../components/editor/VideoPlayer";
import TrimUI from "./TrimUI";
import { ContentStateContext } from "../../context/ContentState";
import TranscriptPanel from "../../components/editor/TranscriptPanel";

const Editor = () => {
  const [contentState, setContentState] = useContext(ContentStateContext);

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
    <div className="saylessEditor" data-testid="editor-layout">
      <EditorNav />
      <main className="saylessEditor__workspace">
        <section className="saylessEditor__mediaColumn">
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

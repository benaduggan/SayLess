import "../../src/pages/EditorApp/styles/edit/_VideoPlayer.scss";
import "../../src/pages/EditorApp/styles/global/_app.scss";
import trimStyles from "../../src/pages/EditorApp/styles/edit/_TrimUI.module.scss";

const transcriptWords = Array.from({ length: 520 }, (_, index) => {
  const word = ["local", "editing", "keeps", "timeline", "visible"][index % 5];
  return `<span class="layout-word">${word} </span>`;
}).join("");

const clipNodes = Array.from({ length: 5 }, (_, index) => {
  const widths = [28, 18, 24, 12, 18];
  return `<div class="layout-clip" style="width:${widths[index]}%"><span>${index + 1}</span><span>${widths[index] / 10}s</span></div>`;
}).join("");

document.body.innerHTML = `
  <div class="saylessEditor">
    <div class="layout-nav">SayLess editor</div>
    <main class="saylessEditor__workspace">
      <section class="saylessEditor__mediaColumn">
        <div class="videoPlayer">
          <div class="playerWrap">
            <div class="plyr plyr--video sayless-native-player-shell" style="aspect-ratio: 16 / 9">
              <video class="sayless-native-player" controls></video>
            </div>
          </div>
        </div>
        <div class="${trimStyles.trimWrap} trimWrap" style="padding: 0 24px 20px; box-sizing: border-box;">
          <div class="layout-timeline-header">
            <span>Timeline</span>
            <span>5 clips · 10s</span>
            <span class="layout-spacer"></span>
            <button class="button simpleButton">Reset</button>
            <button class="button secondaryButton">Apply edits</button>
          </div>
          <div class="layout-timeline-toolbar">
            <button>Undo</button>
            <button>Redo</button>
            <button>Split at playhead</button>
            <button>Move left</button>
            <button>Move right</button>
            <button>Mute</button>
            <button>Delete clip</button>
          </div>
          <div class="layout-timeline-track">
            <div class="layout-ruler"></div>
            <div class="layout-strip">${clipNodes}</div>
            <div class="layout-playhead"></div>
          </div>
          <div class="layout-hint">click a clip to seek there · drag the ruler to scrub · drag clips to reorder</div>
        </div>
      </section>
      <aside class="saylessEditor__transcriptPanel">
        <div class="layout-transcript-inline">
          <div class="layout-transcript-header">
            <span>Transcript</span>
            <span>word-level local editing</span>
          </div>
          <div class="layout-transcript-body">
            <div class="layout-model-status">Model ready · bundled local speech model</div>
            <div class="layout-actions">
              <button>Delete words</button>
              <button>Mute words</button>
              <button>Regenerate</button>
              <button>Delete transcript</button>
            </div>
            <div class="layout-suggestions">Suggestions · local transcript and audio analysis</div>
            <p>${transcriptWords}</p>
          </div>
        </div>
      </aside>
    </main>
  </div>
`;

const style = document.createElement("style");
style.textContent = `
  .layout-nav {
    position: fixed;
    inset: 0 0 auto;
    height: 80px;
    z-index: 20;
    display: flex;
    align-items: center;
    padding: 0 24px;
    box-sizing: border-box;
    background: #fff;
    border-bottom: 1px solid #e8e8e8;
    font-weight: 700;
  }
  .layout-timeline-header,
  .layout-timeline-toolbar,
  .layout-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .layout-timeline-header {
    margin-bottom: 8px;
  }
  .layout-spacer {
    flex: 1;
  }
  .layout-timeline-toolbar {
    margin-bottom: 6px;
  }
  .layout-timeline-toolbar button,
  .layout-actions button {
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid #ddd;
    background: #fff;
    font-size: 12px;
  }
  .layout-timeline-track {
    position: relative;
    border-radius: 8px;
    overflow: hidden;
    background: #f4f6f8;
  }
  .layout-ruler {
    height: 16px;
    background: #e7ebf0;
    border-bottom: 1px solid #dde3ea;
  }
  .layout-strip {
    display: flex;
    align-items: stretch;
    height: 52px;
  }
  .layout-clip {
    box-sizing: border-box;
    min-width: 28px;
    background: #cfe0ff;
    border-right: 2px solid #f4f6f8;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 4px 6px;
    overflow: hidden;
    font-size: 11px;
  }
  .layout-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 42%;
    width: 2px;
    background: #ff3b30;
  }
  .layout-hint {
    color: #888;
    font-size: 11px;
    margin-top: 4px;
  }
  .layout-transcript-inline {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: #fff;
    font-size: 14px;
    line-height: 1.7;
  }
  .layout-transcript-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid #eee;
  }
  .layout-transcript-header span:first-child {
    font-weight: 700;
  }
  .layout-transcript-header span:last-child {
    color: #888;
    font-size: 12px;
  }
  .layout-transcript-body {
    padding: 16px;
    overflow: auto;
    flex: 1;
    min-height: 0;
  }
  .layout-model-status,
  .layout-suggestions {
    border: 1px solid #d9e2ef;
    border-radius: 8px;
    padding: 8px 10px;
    margin-bottom: 10px;
    background: #f6f8fb;
  }
  .layout-word {
    display: inline;
  }
`;
document.head.append(style);

const rectOf = (selector) => {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`Missing selector: ${selector}`);
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  return {
    selector,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    overflowY: style.overflowY,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
  };
};

window.EDITOR_LAYOUT_SMOKE = {
  measure() {
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      bodyScrollHeight: document.documentElement.scrollHeight,
      editor: rectOf(".saylessEditor"),
      workspace: rectOf(".saylessEditor__workspace"),
      media: rectOf(".saylessEditor__mediaColumn"),
      player: rectOf(".videoPlayer"),
      playerWrap: rectOf(".playerWrap"),
      plyr: rectOf(".plyr"),
      timeline: rectOf(".trimWrap"),
      timelineTrack: rectOf(".layout-timeline-track"),
      transcriptPanel: rectOf(".saylessEditor__transcriptPanel"),
      transcriptBody: rectOf(".layout-transcript-body"),
    };
  },
};

window.EDITOR_LAYOUT_READY = true;

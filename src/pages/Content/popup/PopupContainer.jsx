import React, {
  useState,
  useEffect,
  useContext,
  useLayoutEffect,
  useRef,
} from "react";
import * as Tabs from "@radix-ui/react-tabs";

import {
  RecordTabActive,
  RecordTabInactive,
  VideoTabActive,
  VideoTabInactive,
  TempLogo,
} from "../images/popup/images";

import { Rnd } from "react-rnd";

import {
  CloseIconPopup,
  GrabIconPopup,
  HelpIconPopup,
} from "../toolbar/components/SVG";

import RecordingTab from "./layout/RecordingTab";
import VideosTab from "./layout/VideosTab";

import SettingsMenu from "./layout/SettingsMenu";

import { contentStateContext } from "../context/ContentState";

const assertLocalExtensionUrl = (url) => {
  const baseUrl = chrome.runtime.getURL("");
  if (typeof url !== "string" || !url.startsWith(baseUrl)) {
    throw new Error("Expected local extension URL.");
  }
  return url;
};

const PopupContainer = (props) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const contentStateRef = useRef(contentState);
  const [tab, setTab] = useState("record");
  const [badge, setBadge] = useState(TempLogo);
  const DragRef = useRef(null);
  const positionRef = useRef({
    x: contentState.popupPosition.offsetX,
    y: contentState.popupPosition.offsetY,
  });
  const PopupRef = useRef(null);
  const [elastic, setElastic] = React.useState("");
  const [shake, setShake] = React.useState("");
  const [dragging, setDragging] = React.useState("");
  const [open, setOpen] = useState(false);
  const recordTabRef = useRef(null);
  const videoTabRef = useRef(null);
  const pillRef = useRef(null);
  const helpURL = chrome.runtime.getURL("setup.html");
  const openLocalHelpPage = () => {
    window.open(assertLocalExtensionUrl(helpURL), "_blank");
  };

  const updateDragPosition = (position) => {
    positionRef.current = position;
    if (typeof DragRef.current?.updatePosition === "function") {
      DragRef.current.updatePosition(position);
    }
  };

  const onValueChange = (tab) => {
    setTab(tab);

    setBadge(TempLogo);

    setContentState((prevContentState) => ({
      ...prevContentState,
      bigTab: tab,
    }));
  };
  useEffect(() => {
    setTab(contentState.bigTab);
  }, []);

  useEffect(() => {
    setBadge(TempLogo);
  }, [tab]);

  useLayoutEffect(() => {
    if (!recordTabRef.current || !videoTabRef.current || !pillRef.current)
      return;

    const tabRef =
      tab === "record" ? recordTabRef.current : videoTabRef.current;

    pillRef.current.style.left = `${tabRef.offsetLeft}px`;
    pillRef.current.style.width = `${tabRef.getBoundingClientRect().width}px`;
  }, [tab]);

  useEffect(() => {
    contentStateRef.current = contentState;
  }, [contentState]);

  useLayoutEffect(() => {
    function setPopupPosition(e) {
      let xpos = positionRef.current.x;
      let ypos = positionRef.current.y;

      const rect = PopupRef.current.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      // Keep popup positioned proportionally to bottom-right.
      if (xpos > window.innerWidth + 10) {
        xpos = window.innerWidth + 10;
      }
      if (ypos + height + 40 > window.innerHeight) {
        ypos = window.innerHeight - height - 40;
      }

      if (contentStateRef.current.popupPosition.fixed) {
        if (xpos < window.innerWidth) {
          xpos = window.innerWidth + 10;
        }
      }

      updateDragPosition({ x: xpos, y: ypos });
    }
    window.addEventListener("resize", setPopupPosition);
    setPopupPosition();
    return () => window.removeEventListener("resize", setPopupPosition);
  }, []);

  const handleDragStart = (e, d) => {
    setDragging("ToolbarDragging");
  };

  const handleDrag = (e, d) => {
    positionRef.current = { x: d.x, y: d.y };
    // Drag fires ~60Hz; cache rect to avoid 120 reflows/sec.
    const rect = PopupRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (
      d.x - 40 < width ||
      d.x > window.innerWidth + 10 ||
      d.y < 0 ||
      d.y + height + 40 > window.innerHeight
    ) {
      setShake("ToolbarShake");
    } else {
      setShake("");
    }
  };

  const handleDrop = (e, d) => {
    positionRef.current = { x: d.x, y: d.y };
    let anim = "ToolbarElastic";
    if (e === null) {
      anim = "";
    }
    setShake("");
    setDragging("");
    let xpos = d.x;
    let ypos = d.y;

    const rect = PopupRef.current.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    if (d.x - 40 < width) {
      setElastic(anim);
      xpos = width + 40;
    } else if (d.x + 10 > window.innerWidth) {
      setElastic(anim);
      xpos = window.innerWidth + 10;
    }

    if (d.y < 0) {
      setElastic(anim);
      ypos = 0;
    } else if (d.y + height + 40 > window.innerHeight) {
      setElastic(anim);
      ypos = window.innerHeight - height - 40;
    }
    updateDragPosition({ x: xpos, y: ypos });

    setTimeout(() => {
      setElastic("");
    }, 250);

    setContentState((prevContentState) => ({
      ...prevContentState,
      popupPosition: {
        ...prevContentState.popupPosition,
        offsetX: xpos,
        offsetY: ypos,
        left: xpos < window.innerWidth / 2 ? true : false,
        right: xpos < window.innerWidth / 2 ? false : true,
        top: ypos < window.innerHeight / 2 ? true : false,
        bottom: ypos < window.innerHeight / 2 ? false : true,
      },
    }));

    let left = xpos < window.innerWidth / 2 ? true : false;
    let right = xpos < window.innerWidth / 2 ? false : true;
    let top = ypos < window.innerHeight / 2 ? true : false;
    let bottom = ypos < window.innerHeight / 2 ? false : true;
    let offsetX = xpos;
    let offsetY = ypos;
    let fixed = d.x + 9 > window.innerWidth ? true : false;

    if (right) {
      offsetX = window.innerWidth - xpos;
    }
    if (bottom) {
      offsetY = window.innerHeight - ypos;
    }

    setContentState((prevContentState) => ({
      ...prevContentState,
      popupPosition: {
        ...prevContentState.popupPosition,
        offsetX: offsetX,
        offsetY: offsetY,
        left: left,
        right: right,
        top: top,
        bottom: bottom,
        fixed: fixed,
      },
    }));

    chrome.storage.local.set({
      popupPosition: {
        offsetX: offsetX,
        offsetY: offsetY,
        left: left,
        right: right,
        top: top,
        bottom: bottom,
        fixed: fixed,
      },
    });
  };

  useEffect(() => {
    let x = contentState.popupPosition.offsetX;
    let y = contentState.popupPosition.offsetY;

    if (contentState.popupPosition.bottom) {
      y = window.innerHeight - contentState.popupPosition.offsetY;
    }

    if (contentState.popupPosition.right) {
      x = window.innerWidth - contentState.popupPosition.offsetX;
    }

    updateDragPosition({ x: x, y: y });

    handleDrop(null, { x: x, y: y });
  }, []);

  useEffect(() => {
    requestAnimationFrame(() => {
      const tabRef =
        contentState.bigTab === "record"
          ? recordTabRef.current
          : videoTabRef.current;

      if (tabRef && pillRef.current) {
        pillRef.current.style.left = `${tabRef.offsetLeft}px`;
        pillRef.current.style.width = `${
          tabRef.getBoundingClientRect().width
        }px`;
      }
    });
  }, [
    contentState.bigTab,
    pillRef.current,
  ]);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100vw",
        height: "100vh",
      }}
    >
      <div className={"ToolbarBounds" + " " + shake}></div>
      <Rnd
        default={{
          x: contentState.popupPosition.offsetX,
          y: contentState.popupPosition.offsetY,
        }}
        className={
          "react-draggable" + " " + elastic + " " + shake + " " + dragging
        }
        enableResizing={false}
        dragHandleClassName="drag-area"
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragStop={handleDrop}
        ref={DragRef}
      >
        <div
          className="popup-container"
          id="local-tour-popup-container"
          ref={PopupRef}
        >
          <div
            className={open ? "popup-drag-head" : "popup-drag-head drag-area"}
          ></div>
          <div
            className={
              open ? "popup-controls open" : "popup-controls drag-area"
            }
          >
            <SettingsMenu
              shadowRef={props.shadowRef}
              open={open}
              setOpen={setOpen}
            />
            <div
              style={{ marginBottom: "-4px", cursor: "pointer" }}
              onClick={openLocalHelpPage}
            >
              <HelpIconPopup />
            </div>
            <div
              className="popup-control popup-close"
              onClick={() => {
                setContentState((prevContentState) => ({
                  ...prevContentState,
                  showExtension: false,
                }));
              }}
            >
              <CloseIconPopup />
            </div>
          </div>
          <div className="popup-cutout drag-area">
            <img
              src={badge}
              crossOrigin="anonymous"
              style={{
                width: "90%",
                height: "90%",
                filter:
                  "drop-shadow(rgba(86, 123, 218, 0.35) 0px 4px 11px) drop-shadow(rgba(53, 87, 98, 0.2) 0px 4px 10px)",
                userSelect: "none",
                pointerEvents: "none",
              }}
              draggable={false}
              referrerPolicy="no-referrer"
            />
          </div>
          <div className="popup-nav"></div>
          <div className="popup-content">
            <Tabs.Root
                className="TabsRoot tl"
                value={tab}
                onValueChange={onValueChange}
              >
                <Tabs.List
                  className="TabsList tl"
                  data-value={tab}
                  aria-label="Choose popup section"
                  tabIndex={0}
                >
                  <div className="pill-anim" ref={pillRef}></div>
                  <Tabs.Trigger
                    className="TabsTrigger tl"
                    value="record"
                    ref={recordTabRef}
                    tabIndex={0}
                  >
                    <div className="TabsTriggerIcon">
                      <img
                        src={
                          tab === "record" ? RecordTabActive : RecordTabInactive
                        }
                      />
                    </div>
                    {chrome.i18n.getMessage("recordTab")}
                  </Tabs.Trigger>
                  <Tabs.Trigger
                    className="TabsTrigger tl"
                    value="videos"
                    ref={videoTabRef}
                    tabIndex={0}
                  >
                    <div className="TabsTriggerIcon">
                      <img
                        src={
                          tab === "videos"
                            ? VideoTabActive
                            : VideoTabInactive
                        }
                      />
                    </div>
                    {chrome.i18n.getMessage("videosTab")}
                  </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content className="TabsContent tl" value="record">
                  <RecordingTab shadowRef={props.shadowRef} />
                </Tabs.Content>
                <Tabs.Content className="TabsContent tl" value="videos">
                  <VideosTab shadowRef={props.shadowRef} />
                </Tabs.Content>
              </Tabs.Root>
          </div>
          {contentState.settingsOpen && (
            <div
              className="HelpSection"
              onClick={openLocalHelpPage}
            >
              <span className="HelpIcon">
                <HelpIconPopup />
              </span>
              {chrome.i18n.getMessage("helpPopup")}
            </div>
          )}
        </div>
      </Rnd>
    </div>
  );
};

export default PopupContainer;

import React, { useEffect, useState, useContext } from "react";
import * as Tabs from "@radix-ui/react-tabs";

import RecordingType from "./RecordingType";
import {
  ScreenTabOn,
  ScreenTabOff,
  RegionTabOn,
  RegionTabOff,
  CameraTabIconOn,
  CameraTabIconOff,
  CloseWhiteIcon,
} from "../../images/popup/images";
import TooltipWrap from "../components/TooltipWrap";

// Context
import { contentStateContext } from "../../context/ContentState";

const RecordingTab = (props: {
  shadowRef: React.RefObject<HTMLElement | null>;
}) => {
  const [contentState, setContentState] = useContext(contentStateContext);

  const [tabRecordingDisabled, setTabRecordingDisabled] = useState(false);

  // On pages that can't do tab/region capture (chrome://, app pages),
  // swap the visible selection to "screen" but don't persist; the
  // user's stored preference rehydrates on the next mount elsewhere.
  useEffect(() => {
    if (tabRecordingDisabled && contentState.recordingType === "region") {
      setContentState((prev) => ({
        ...prev,
        recordingType: "screen",
      }));
      contentState.openToast?.(
        chrome.i18n.getMessage("tabRecordingDisabledToast"),
        4000
      );
    }
  }, [tabRecordingDisabled]);

  useEffect(() => {
    const isBlocked = false;

    setTabRecordingDisabled(isBlocked);

    if (isBlocked && contentState.recordingType === "region") {
      setContentState((prev) => ({
        ...prev,
        recordingType: "screen",
      }));
      // Same rationale as above; no storage write, just content-state.
      contentState.openToast?.(
        chrome.i18n.getMessage("tabRecordingDisabledToast"),
        4000
      );
    }
  }, [contentState.recordingType]);

  const onValueChange = (tab: string) => {
    setContentState((prevContentState) => ({
      ...prevContentState,
      recordingType: tab,
    }));
    chrome.storage.local.set({ recordingType: tab });

    if (tab === "camera") {
      chrome.runtime.sendMessage({ type: "camera-only-update" });
    } else {
      chrome.runtime.sendMessage({ type: "screen-update" });
    }
  };

  return (
    <div className="recording-ui">
      <Tabs.Root
        className="TabsRoot"
        defaultValue="screen"
        onValueChange={onValueChange}
        value={
          contentState.recordingType === "tab"
            ? "region"
            : contentState.recordingType
        }
      >
        {contentState.recordingToScene && (
          <div className="projectActiveBanner">
            <div className="projectActiveBannerLeft">
              {chrome.i18n.getMessage("addingToLabel") || "Adding to: "}
              {contentState.recordingProjectTitle}
            </div>
            <div className="projectActiveBannerRight">
              <div className="projectActiveBannerDivider"></div>
              <div
                className="projectActiveBannerClose"
                onClick={() => {
                  setContentState((prev) => ({
                    ...prev,
                    projectTitle: "",
                    projectId: null,
                    activeSceneId: null,
                    recordingToScene: false,
                    multiMode: false,
                    multiSceneCount: 0,
                    multiProjectId: null,
                  }));

                  chrome.storage.local.set({
                    recordingProjectTitle: "",
                    projectId: null,
                    activeSceneId: null,
                    recordingToScene: false,
                    multiMode: false,
                    multiSceneCount: 0,
                    multiProjectId: null,
                    multiLastSceneId: null,
                  });

                  contentState.openToast(
                    chrome.i18n.getMessage("projectRecordingCancelledToast"),
                    3000
                  );
                }}
              >
                <img src={CloseWhiteIcon} alt="Close" />
              </div>
            </div>
          </div>
        )}
        <Tabs.List
          className={"TabsList"}
          aria-label="Choose recording mode"
          tabIndex={0}
        >
          <Tabs.Trigger className="TabsTrigger" value="screen" tabIndex={0}>
            <div className="TabsTriggerLabel">
              <div className="TabsTriggerIcon">
                <img
                  src={
                    contentState.recordingType === "screen"
                      ? ScreenTabOn
                      : ScreenTabOff
                  }
                />
              </div>
              <span>{chrome.i18n.getMessage("screenType")}</span>
            </div>
          </Tabs.Trigger>
          <TooltipWrap
            content={
              tabRecordingDisabled
                ? chrome.i18n.getMessage("tabRecordingDisabledTooltip") ||
                  "Tab recording is disabled on this page."
                : ""
            }
            side={"bottom"}
          >
            <Tabs.Trigger
              className="TabsTrigger"
              value="region"
              tabIndex={0}
              disabled={tabRecordingDisabled}
              onClick={(e) => {
                if (tabRecordingDisabled) {
                  e.preventDefault();
                  e.stopPropagation();
                }
              }}
              style={
                tabRecordingDisabled
                  ? { cursor: "not-allowed", opacity: 0.5 }
                  : {}
              }
            >
              <div className="TabsTriggerLabel">
                <div className="TabsTriggerIcon">
                  <img
                    src={
                      contentState.recordingType === "region"
                        ? RegionTabOn
                        : RegionTabOff
                    }
                  />
                </div>
                <span>{chrome.i18n.getMessage("tabType")}</span>
              </div>
            </Tabs.Trigger>
          </TooltipWrap>
          <Tabs.Trigger className="TabsTrigger" value="camera" tabIndex={0}>
            <div className="TabsTriggerLabel">
              <div className="TabsTriggerIcon">
                <img
                  src={
                    contentState.recordingType === "camera"
                      ? CameraTabIconOn
                      : CameraTabIconOff
                  }
                />
              </div>
              <span>{chrome.i18n.getMessage("cameraType")}</span>
            </div>
          </Tabs.Trigger>
          <div className="TabsTriggerSpacer"></div>
          {/* <Tabs.Trigger
            className="TabsTrigger"
            value="mockup"
            tabIndex={0}
            disabled
            style={{ pointerEvents: "none", opacity: 0.5 }}
          >
            <div className="TabsTriggerLabel">
              <div className="TabsTriggerIcon">
                <img
                  src={
                    contentState.recordingType === "mockup"
                      ? MockupTabOn
                      : MockupTabOff
                  }
                />
              </div>
              <span>{chrome.i18n.getMessage("MockupType")}</span>
            </div>
          </Tabs.Trigger> */}
        </Tabs.List>
        <Tabs.Content className="TabsContent" value="screen">
          <RecordingType shadowRef={props.shadowRef} />
        </Tabs.Content>
        <Tabs.Content className="TabsContent" value="region">
          <RecordingType shadowRef={props.shadowRef} />
        </Tabs.Content>
        <Tabs.Content className="TabsContent" value="camera">
          <RecordingType shadowRef={props.shadowRef} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};

export default RecordingTab;

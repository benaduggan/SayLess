import React, { useState, useEffect, useContext, useRef } from "react";
import * as Toolbar from "@radix-ui/react-toolbar";
import TooltipWrap from "../components/TooltipWrap";

// Context
import { contentStateContext } from "../../context/ContentState";

// Icons
import {
  CursorIcon,
  TargetCursorIcon,
  HighlightCursorIcon,
  SpotlightCursorIcon,
  HideCursorIcon,
} from "../components/SVG";

type CursorEffect = "target" | "highlight" | "spotlight";
type CursorMode = CursorEffect | "none";

const CursorToolbar = (props: {
  visible?: string;
  mode?: string;
  setMode: React.Dispatch<React.SetStateAction<any>>;
}) => {
  const [contentState, setContentState] = useContext(contentStateContext);
  const lastClickedEffectRef = useRef<CursorMode>(
    (contentState.cursorMode as CursorMode) || "none"
  );

  useEffect(() => {
    if (contentState.cursorMode) {
      lastClickedEffectRef.current = contentState.cursorMode as CursorMode;
    }
  }, [contentState.cursorMode]);

  const deriveCursorMode = (
    effects: CursorEffect[],
    fallback: CursorMode
  ): CursorMode => {
    if (effects.length === 0) return "none";
    if (effects.length === 1) return effects[0];
    if (fallback !== "none" && effects.includes(fallback)) return fallback;
    return effects[0] || "none";
  };

  const applyCursorSelection = (effect: CursorMode, shiftKey: boolean) => {
    if (effect === "none") {
      lastClickedEffectRef.current = "none";
      setContentState((prev) => ({
        ...prev,
        cursorEffects: [],
        cursorMode: "none",
      }));
      if (!shiftKey) {
        props.setMode(false);
      }
      chrome.storage.local.set({
        cursorEffects: [],
        cursorMode: "none",
      });
      return;
    }

    const currentEffects: CursorEffect[] = Array.isArray(
      contentState.cursorEffects
    )
      ? contentState.cursorEffects
      : [];

    let nextEffects: CursorEffect[] = [];
    if (shiftKey) {
      if (currentEffects.includes(effect)) {
        nextEffects = currentEffects.filter((item) => item !== effect);
      } else {
        nextEffects = [...currentEffects, effect];
      }
    } else {
      nextEffects = [effect];
    }

    lastClickedEffectRef.current = effect;
    const nextMode = deriveCursorMode(
      nextEffects,
      lastClickedEffectRef.current
    );

    setContentState((prev) => ({
      ...prev,
      cursorEffects: nextEffects,
      cursorMode: nextMode,
    }));
    if (!shiftKey) {
      props.setMode(false);
    }
    chrome.storage.local.set({
      cursorEffects: nextEffects,
      cursorMode: nextMode,
    });
  };

  const handleClick =
    (effect: CursorMode) => (event: React.MouseEvent<HTMLButtonElement>) => {
      applyCursorSelection(effect, Boolean(event.shiftKey));
    };

  const cursorEffects: CursorEffect[] = Array.isArray(
    contentState.cursorEffects
  )
    ? contentState.cursorEffects
    : [];
  const isDefault = cursorEffects.length === 0;
  const toggleValues = isDefault ? ["none"] : cursorEffects;
  const isEffectActive = (effect: CursorMode) =>
    effect === "none" ? isDefault : cursorEffects.includes(effect);

  return (
    <Toolbar.Root
      className={"DrawingToolbar" + " " + props.visible}
      aria-label="Cursor options"
      tabIndex={0}
    >
      <Toolbar.ToggleGroup
        type="multiple"
        className="ToolbarToggleGroup"
        value={toggleValues}
        onValueChange={() => {}}
      >
        <TooltipWrap content="Default" shortcut="0">
          <div className="ToolbarToggleWrap">
            <Toolbar.ToggleItem
              className="ToolbarToggleItem"
              value="none"
              data-state={isEffectActive("none") ? "on" : "off"}
              onClick={handleClick("none")}
            >
              <CursorIcon />
            </Toolbar.ToggleItem>
          </div>
        </TooltipWrap>
        <Toolbar.Separator className="ToolbarSeparator" />
        <TooltipWrap
          content={chrome.i18n.getMessage("highlightClicksTooltip")}
          shortcut="1"
        >
          <div className="ToolbarToggleWrap">
            <Toolbar.ToggleItem
              className="ToolbarToggleItem"
              value="target"
              data-state={isEffectActive("target") ? "on" : "off"}
              onClick={handleClick("target")}
            >
              <TargetCursorIcon />
            </Toolbar.ToggleItem>
          </div>
        </TooltipWrap>
        <TooltipWrap
          content={chrome.i18n.getMessage("highlightCursorTooltip")}
          shortcut="2"
        >
          <div className="ToolbarToggleWrap">
            <Toolbar.ToggleItem
              className="ToolbarToggleItem"
              value="highlight"
              data-state={isEffectActive("highlight") ? "on" : "off"}
              onClick={handleClick("highlight")}
            >
              <HighlightCursorIcon />
            </Toolbar.ToggleItem>
          </div>
        </TooltipWrap>
        <TooltipWrap
          content={chrome.i18n.getMessage("spotlightCursorTooltip")}
          shortcut="3"
        >
          <div className="ToolbarToggleWrap">
            <Toolbar.ToggleItem
              className="ToolbarToggleItem"
              value="spotlight"
              data-state={isEffectActive("spotlight") ? "on" : "off"}
              onClick={handleClick("spotlight")}
            >
              <SpotlightCursorIcon />
            </Toolbar.ToggleItem>
          </div>
        </TooltipWrap>
      </Toolbar.ToggleGroup>
    </Toolbar.Root>
  );
};

export default CursorToolbar;

import React from "react";
import * as Toolbar from "@radix-ui/react-toolbar";

// Components
import TooltipWrap from "./TooltipWrap";

interface ToolTriggerProps {
  grab?: boolean;
  resume?: boolean;
  content: React.ReactNode;
  shortcut?: React.ReactNode;
  type?: "button" | "mode" | "toggle";
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  children?: React.ReactNode;
  value?: string;
}

const ToolTrigger = (props: ToolTriggerProps) => {
  const grab = props.grab ? " grab" : "";
  const resume = props.resume ? " resume" : "";

  return (
    <TooltipWrap content={props.content} shortcut={props.shortcut}>
      {props.type === "button" ? (
        <Toolbar.Button
          className={"ToolbarButton" + grab + resume}
          onClick={props.onClick}
          disabled={props.disabled}
        >
          {props.children}
        </Toolbar.Button>
      ) : props.type === "mode" ? (
        <div className="ToolbarToggleWrap">
          <Toolbar.ToggleItem
            className="ToolbarModeItem"
            value={props.value || ""}
            disabled={props.disabled}
          >
            {props.children}
          </Toolbar.ToggleItem>
        </div>
      ) : (
        <div className="ToolbarToggleWrap">
          <Toolbar.ToggleItem
            className="ToolbarToggleItem"
            value={props.value || ""}
            disabled={props.disabled}
          >
            {props.children}
          </Toolbar.ToggleItem>
        </div>
      )}
    </TooltipWrap>
  );
};

export default ToolTrigger;

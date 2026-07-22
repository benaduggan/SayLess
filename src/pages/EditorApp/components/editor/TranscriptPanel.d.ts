import type { ComponentType } from "react";

export interface TranscriptPanelProps {
  variant?: "drawer" | "inline";
}

declare const TranscriptPanel: ComponentType<TranscriptPanelProps>;
export default TranscriptPanel;

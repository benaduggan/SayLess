import React from "react";
import { ReactSVG } from "react-svg";

const ASSET_URL = chrome.runtime.getURL("assets/");

export interface IconProps {
  width?: string | number;
  height?: string | number;
  className?: string;
}

type IconComponent = React.FC<IconProps>;

const createIcon = (path: string): IconComponent =>
  function Icon({ width, height, className }) {
    return <ReactSVG src={ASSET_URL + path} width={width} height={height} className={className} />;
  };

const strokeIconStyle: React.CSSProperties = {
  textAlign: "center",
  margin: "auto",
  display: "block",
  width: "100%",
  height: "100%",
};

const createStrokeIcon = (path: string): IconComponent =>
  function StrokeIcon({ width, height, className }) {
    return (
      <ReactSVG
        src={ASSET_URL + path}
        width={width}
        height={height}
        className={className}
        style={strokeIconStyle}
      />
    );
  };

const GrabIcon = createIcon("tool-icons/grab-icon.svg");
const StopIcon = createIcon("tool-icons/stop-icon.svg");
const DrawIcon = createIcon("tool-icons/draw-icon.svg");
const PauseIcon = createIcon("tool-icons/pause-icon.svg");
const ResumeIcon = createIcon("tool-icons/resume-icon.svg");
const CursorIcon = createIcon("tool-icons/cursor-icon.svg");
const CommentIcon = createIcon("tool-icons/comment-icon.svg");
const MicIcon = createIcon("tool-icons/mic-icon.svg");
const MoreIcon = createIcon("tool-icons/more-icon.svg");
const RestartIcon = createIcon("tool-icons/restart-icon.svg");
const DiscardIcon = createIcon("tool-icons/discard-icon.svg");
const EyeDropperIcon = createIcon("tool-icons/eyedropper-icon.svg");
const Stroke1Icon = createStrokeIcon("tool-icons/stroke-1-icon.svg");
const Stroke2Icon = createStrokeIcon("tool-icons/stroke-2-icon.svg");
const Stroke3Icon = createStrokeIcon("tool-icons/stroke-3-icon.svg");
const TargetCursorIcon = createIcon("tool-icons/target-cursor-icon.svg");
const HighlightCursorIcon = createIcon("tool-icons/highlight-cursor-icon.svg");
const HideCursorIcon = createIcon("tool-icons/hide-cursor-icon.svg");
const TextIcon = createIcon("tool-icons/text-icon.svg");
const ArrowIcon = createIcon("tool-icons/arrow-icon.svg");
const EraserIcon = createIcon("tool-icons/eraser-icon.svg");
const PenIcon = createIcon("tool-icons/pen-icon.svg");
const ShapeIcon = createIcon("tool-icons/shape-icon.svg");
const SelectIcon = createIcon("tool-icons/select-icon.svg");
const UndoIcon = createIcon("tool-icons/undo-icon.svg");
const RedoIcon = createIcon("tool-icons/redo-icon.svg");
const ImageIcon = createIcon("tool-icons/image-icon.svg");
const TransformIcon = createIcon("tool-icons/transform-icon.svg");
const HighlighterIcon = createIcon("tool-icons/highlighter-icon.svg");
const RectangleIcon = createIcon("tool-icons/rectangle-icon.svg");
const CircleIcon = createIcon("tool-icons/circle-icon.svg");
const TriangleIcon = createIcon("tool-icons/triangle-icon.svg");
const RectangleFilledIcon = createIcon("tool-icons/rectangle-filled-icon.svg");
const CircleFilledIcon = createIcon("tool-icons/circle-filled-icon.svg");
const TriangleFilledIcon = createIcon("tool-icons/triangle-filled-icon.svg");
const TrashIcon = createIcon("tool-icons/trash-icon.svg");
const VideoOffIcon = createIcon("camera-icons/video-off.svg");
const CameraCloseIcon = createIcon("camera-icons/close.svg");
const CameraMoreIcon = createIcon("camera-icons/more.svg");
const CameraResizeIcon = createIcon("camera-icons/camera-resize.svg");
const CameraIcon = createIcon("tool-icons/camera-icon.svg");
const BlurIcon = createIcon("tool-icons/blur-icon.svg");
const AlertIcon = createIcon("tool-icons/alert-icon.svg");
const TimeIcon = createIcon("tool-icons/time-icon.svg");
const SpotlightCursorIcon = createIcon("tool-icons/spotlight-cursor-icon.svg");
const Pip = createIcon("camera-icons/pip.svg");
const CloseIconPopup = createIcon("close-icon-popup.svg");
const GrabIconPopup = createIcon("grab-icon-popup.svg");
const MoreIconPopup = createIcon("more-icon-popup.svg");
const OnboardingArrow = createIcon("/helper/onboarding-arrow.svg");
const NoInternet = createIcon("/editor/icons/no-internet.svg");
const CloseButtonToolbar = createIcon("/tool-icons/close-button.svg");
const HelpIconPopup = createIcon("/tool-icons/help-icon.svg");
const AudioIcon = createIcon("/tool-icons/audio-icon.svg");
const NotSupportedIcon = createIcon("/tool-icons/not-supported-icon.svg");

export {
  GrabIcon,
  StopIcon,
  DrawIcon,
  PauseIcon,
  ResumeIcon,
  CursorIcon,
  CommentIcon,
  MicIcon,
  MoreIcon,
  RestartIcon,
  DiscardIcon,
  EyeDropperIcon,
  Stroke1Icon,
  Stroke2Icon,
  Stroke3Icon,
  TargetCursorIcon,
  HighlightCursorIcon,
  HideCursorIcon,
  TextIcon,
  ArrowIcon,
  EraserIcon,
  PenIcon,
  ShapeIcon,
  SelectIcon,
  UndoIcon,
  RedoIcon,
  ImageIcon,
  TransformIcon,
  HighlighterIcon,
  RectangleIcon,
  CircleIcon,
  TriangleIcon,
  RectangleFilledIcon,
  CircleFilledIcon,
  TriangleFilledIcon,
  TrashIcon,
  VideoOffIcon,
  CameraCloseIcon,
  CameraMoreIcon,
  CameraResizeIcon,
  CameraIcon,
  BlurIcon,
  AlertIcon,
  TimeIcon,
  SpotlightCursorIcon,
  Pip,
  CloseIconPopup,
  GrabIconPopup,
  OnboardingArrow,
  NoInternet,
  CloseButtonToolbar,
  HelpIconPopup,
  MoreIconPopup,
  AudioIcon,
  NotSupportedIcon,
};

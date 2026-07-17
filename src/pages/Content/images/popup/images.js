// I need to make this work for a Chrome extension, so I can't import images, instead it needs to be a string with the path to the image
const URL = chrome.runtime.getURL("assets");

const DropdownIcon = `${URL}/dropdown.svg`;
const MicOnIcon = `${URL}/mic-on.svg`;
const MicOffIcon = `${URL}/mic-off.svg`;
const CameraOnIcon = `${URL}/camera-on.svg`;
const CameraOffIcon = `${URL}/camera-off.svg`;
const CheckWhiteIcon = `${URL}/check-white.svg`;
const Waveform = `${URL}/waveform.svg`;
const RecordTabActive = `${URL}/record-tab-active.svg`;
const RecordTabInactive = `${URL}/record-tab-inactive.svg`;
const VideoTabActive = `${URL}/video-tab-active.svg`;
const VideoTabInactive = `${URL}/video-tab-inactive.svg`;
const ScreenTabOn = `${URL}/screen-tab-on.svg`;
const ScreenTabOff = `${URL}/screen-tab-off.svg`;
const RegionTabOn = `${URL}/region-tab-on.svg`;
const RegionTabOff = `${URL}/region-tab-off.svg`;
const AudioTabOn = `${URL}/audio-tab-on.svg`;
const AudioTabOff = `${URL}/audio-tab-off.svg`;
const MockupTabOn = `${URL}/mockup-tab-on.svg`;
const MockupTabOff = `${URL}/mockup-tab-off.svg`;
// const TempLogo = `${URL}/temp-logo.png`;
const TempLogo = `${URL}/new-logo.svg`;
const CopyLinkIcon = `${URL}/copy-link.svg`;
const MoreActionsIcon = `${URL}/more-actions.svg`;
const HandleControl = `${URL}/canvas/handle.png`;
const RotateControl = `${URL}/canvas/rotate.png`;
const MiddleHandleControl = `${URL}/canvas/middle-handle.png`;
const MiddleHandleControlV = `${URL}/canvas/middle-handle-v.png`;
const DefaultCursor = `${URL}/cursors/default.svg`;
const CameraTabIconOn = `${URL}/camera-tab-icon-on.svg`;
const CameraTabIconOff = `${URL}/camera-tab-icon-off.svg`;
const CameraOffBlue = `${URL}/camera-off-blue.svg`;
const MicOffBlue = `${URL}/mic-off-blue.svg`;
const DropdownGroup = `${URL}/dropdown-group.svg`;
const PlaceholderThumb = `${URL}/placeholder-thumb.png`;
const CloseWhiteIcon = `${URL}/close-white.svg`;

export {
  DropdownIcon,
  MicOnIcon,
  MicOffIcon,
  CameraOnIcon,
  CameraOffIcon,
  CheckWhiteIcon,
  Waveform,
  RecordTabActive,
  RecordTabInactive,
  VideoTabActive,
  VideoTabInactive,
  ScreenTabOn,
  ScreenTabOff,
  RegionTabOn,
  RegionTabOff,
  AudioTabOn,
  AudioTabOff,
  MockupTabOn,
  MockupTabOff,
  TempLogo,
  CopyLinkIcon,
  MoreActionsIcon,
  HandleControl,
  RotateControl,
  MiddleHandleControl,
  MiddleHandleControlV,
  DefaultCursor,
  CameraTabIconOn,
  CameraTabIconOff,
  CameraOffBlue,
  MicOffBlue,
  DropdownGroup,
  PlaceholderThumb,
  CloseWhiteIcon,
};

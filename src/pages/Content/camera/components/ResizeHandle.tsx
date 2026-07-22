import React from "react";

import { CameraResizeIcon } from "../../toolbar/components/SVG";

interface ResizeHandleProps {
  position?: string;
}

const ResizeHandle: React.FC<ResizeHandleProps> = ({ position: _position }) => {
  return (
    <div className="camera-resize">
      <CameraResizeIcon />
    </div>
  );
};

export default ResizeHandle;

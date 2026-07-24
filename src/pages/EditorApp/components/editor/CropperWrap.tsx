import { useState, useEffect, useContext, useRef } from "react";
import { Cropper } from "react-advanced-cropper";
import type { CropperRef } from "react-advanced-cropper";
import "react-advanced-cropper/dist/style.css";

import { useEditorContent } from "../../context/ContentState";

const CropperWrap = () => {
  const [contentState, setContentState] = useEditorContent();
  const [image, setImage] = useState<string | null>(null);
  const cropperRef = useRef<CropperRef>(null);
  // Guards against onChange firing during setCoordinates push: stale cropper
  // coords would otherwise overwrite state and revert CropUI inputs.
  const pushingToCropperRef = useRef(false);

  useEffect(() => {
    const cropper = cropperRef.current;
    if (!cropper) return;
    const coordinates = cropper.getCoordinates();
    if (!coordinates) return;
    if (contentState.fromCropper) return;
    pushingToCropperRef.current = true;
    cropper.setCoordinates({
      top: Number(contentState.top) || 0,
      left: Number(contentState.left) || 0,
      width: Number(contentState.width) || 0,
      height: Number(contentState.height) || 0,
    });
    pushingToCropperRef.current = false;
    const nextCoordinates = cropper.getCoordinates();
    if (!nextCoordinates) return;
    if (contentState.top != nextCoordinates.top) {
      setContentState((prevState) => ({
        ...prevState,
        top: nextCoordinates.top,
      }));
    }
    if (contentState.left != nextCoordinates.left) {
      setContentState((prevState) => ({
        ...prevState,
        left: nextCoordinates.left,
      }));
    }
    if (contentState.width != nextCoordinates.width) {
      setContentState((prevState) => ({
        ...prevState,
        width: nextCoordinates.width,
      }));
    }
    if (contentState.height != nextCoordinates.height) {
      setContentState((prevState) => ({
        ...prevState,
        height: nextCoordinates.height,
      }));
    }
  }, [contentState.width, contentState.height, contentState.top, contentState.left]);

  const onChange = (cropper: CropperRef) => {
    if (!cropper) return;
    if (pushingToCropperRef.current) return;
    const coordinates = cropper.getCoordinates();
    if (!coordinates) return;
    setContentState((prevState) => ({
      ...prevState,
      top: coordinates.top,
      left: coordinates.left,
      width: coordinates.width,
      height: coordinates.height,
      fromCropper: true,
    }));
  };

  useEffect(() => {
    if (!contentState.blob) return;

    setImage(typeof contentState.frame === "string" ? contentState.frame : null);
  }, [contentState.frame]);

  return (
    <div data-testid="project-crop-preview">
      <Cropper
        src={image}
        ref={cropperRef}
        onChange={onChange}
        className={"cropper"}
        stencilProps={{
          grid: true,
        }}
        defaultSize={{
          width: Number(contentState.width) || 0,
          height: Number(contentState.height) || 0,
        }}
        backgroundWrapperClassName="CropperBackgroundWrapper"
        transitions={false}
        style={{ transition: "none" }}
      />
    </div>
  );
};

export default CropperWrap;

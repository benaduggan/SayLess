import { forwardRef, useEffect, useState, useContext } from "react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import * as Select from "@radix-ui/react-select";

import styles from "../../styles/edit/_Dropdown.module.scss";

// Icons
//import DropdownIcon from "../../public/assets/icons/dropdown.svg";
//import CheckWhiteIcon from "../../public/assets/icons/check-white.svg";

// Context
import { useEditorContent } from "../../context/ContentState";

const assetUrl = (path: string) => chrome.runtime.getURL(`assets/${path}`);

interface DropdownProps {
  icon?: ReactNode;
}

interface CropPreset {
  name: string;
  label: string;
  width?: number;
  height?: number;
}

const Dropdown = (props: DropdownProps) => {
  const [contentState, setContentState] = useEditorContent();

  const [label, setLabel] = useState("None");
  const [value, setValue] = useState("none");

  // Video presets for Youtube, Instagram, TikTok, etc.
  const presets: CropPreset[] = [
    {
      name: "none",
      label: "None",
    },
    {
      name: "Youtube",
      label: "Youtube",
      width: 1920,
      height: 1080,
    },
    {
      name: "YoutubeShorts",
      label: "Youtube Shorts",
      width: 1920,
      height: 1080,
    },
    {
      name: "InstagramPost",
      label: "Instagram Post",
      width: 1080,
      height: 1080,
    },
    {
      name: "InstagramStory",
      label: "Instagram Story",
      width: 1080,
      height: 1920,
    },
    {
      name: "TikTok",
      label: "TikTok",
      width: 1080,
      height: 1920,
    },
    {
      name: "Facebook",
      label: "Facebook",
      width: 1080,
      height: 1080,
    },
    {
      name: "Twitter",
      label: "Twitter",
      width: 1080,
      height: 1080,
    },
    {
      name: "Dribbble",
      label: "Dribbble",
      width: 2800,
      height: 2100,
    },
  ];

  useEffect(() => {
    // Update the value when the contentState changes
    const cropPreset = String(contentState.cropPreset || "none");
    const selectedPreset = presets.find((preset) => preset.name === cropPreset);
    setValue(cropPreset);
    setLabel(selectedPreset?.label || "None");

    if (
      !selectedPreset ||
      selectedPreset.name === "none" ||
      selectedPreset.width == null ||
      selectedPreset.height == null
    ) return;
    const preset = selectedPreset;
    const presetWidth = Number(preset.width);
    const presetHeight = Number(preset.height);
    const aspectRatio = presetWidth / presetHeight;
    const maxWidth = Number(contentState.prevWidth) || presetWidth;
    const maxHeight = Number(contentState.prevHeight) || presetHeight;

    let width = Math.min(presetWidth, maxWidth);
    let height = Math.min(presetHeight, maxHeight);

    if (width > maxWidth || height > maxHeight) {
      if (width / height > aspectRatio) {
        width = Math.min(maxWidth, width);
        height = width / aspectRatio;
      } else {
        height = Math.min(maxHeight, height);
        width = height * aspectRatio;
      }
    }

    if (width > maxWidth) {
      width = maxWidth;
      height = width / aspectRatio;
    }

    if (height > maxHeight) {
      height = maxHeight;
      width = height * aspectRatio;
    }

    const left = maxWidth / 2 - width / 2;
    const top = maxHeight / 2 - height / 2;

    setContentState((prevContentState) => ({
      ...prevContentState,
      fromCropper: false,
      width: width,
      height: height,
      left: left,
      top: top,
    }));
  }, [contentState.cropPreset]);

  return (
    <Select.Root
      value={value}
      onValueChange={(newValue) => {
        setValue(newValue);
        setLabel(
          presets.find((preset) => preset.name === newValue)?.label || "None",
        );
        setContentState((prevContentState) => ({
          ...prevContentState,
          cropPreset: newValue,
        }));
      }}
    >
      <Select.Trigger className={styles.SelectTrigger} aria-label="Crop preset">
        {props.icon && (
          <Select.Icon className={styles.SelectIconType}></Select.Icon>
        )}
        <div className={styles.SelectValue}>
          <Select.Value placeholder="Select a source">{label}</Select.Value>
        </div>
        <Select.Icon className={styles.SelectIconDrop}>
          <img src={assetUrl("editor/icons/dropdown.svg")} alt="" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal className={styles.Portal}>
        <Select.Content position="popper" className={styles.SelectContent}>
          <Select.ScrollUpButton
            className={styles.SelectScrollButton}
          ></Select.ScrollUpButton>
          <Select.Viewport className={styles.SelectViewport}>
            <Select.Group>
              <SelectItem value="none">None</SelectItem>
            </Select.Group>

            <Select.Separator className={styles.SelectSeparator} />
            <Select.Group>
              {presets.map(
                (preset, index) =>
                  preset.name !== "none" && (
                    <SelectItem value={preset.name} key={index}>
                      {preset.label}
                    </SelectItem>
                  )
              )}
            </Select.Group>
          </Select.Viewport>
          <Select.ScrollDownButton
            className={styles.SelectScrollButton}
          ></Select.ScrollDownButton>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
};

type SelectItemProps = ComponentPropsWithoutRef<typeof Select.Item>;

const SelectItem = forwardRef<HTMLDivElement, SelectItemProps>(
  ({ children, ...props }, forwardedRef) => {
    return (
      <Select.Item className={styles.SelectItem} {...props} ref={forwardedRef}>
        <Select.ItemText>{children}</Select.ItemText>
        <Select.ItemIndicator className={styles.SelectItemIndicator}>
          <img src={assetUrl("editor/icons/check-white.svg")} alt="" />
        </Select.ItemIndicator>
      </Select.Item>
    );
  }
);

export default Dropdown;

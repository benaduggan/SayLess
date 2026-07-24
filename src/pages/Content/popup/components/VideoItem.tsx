import React from "react";

import { CopyLinkIcon, MoreActionsIcon } from "../../images/popup/images";

interface VideoItemStatus {
  kind?: "warning" | string;
  label: React.ReactNode;
}

interface VideoItemProps {
  title?: React.ReactNode;
  date: string | number | Date;
  meta?: React.ReactNode;
  status?: VideoItemStatus;
  thumbnail?: string;
  selected?: boolean;
  onSelectToggle?: () => void;
  onOpen: () => void;
  onCopyLink: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onExport?: () => void;
  onSaveToFile?: () => void;
  onRepair?: () => void;
  onDelete?: () => void;
}

const VideoItem: React.FC<VideoItemProps> = ({
  title,
  date,
  meta,
  status,
  thumbnail,
  selected = false,
  onSelectToggle,
  onOpen,
  onCopyLink,
  onRename,
  onDuplicate,
  onExport,
  onSaveToFile,
  onRepair,
  onDelete,
}) => {
  const formatRelativeTime = (timestamp: string | number | Date): string => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffInSeconds = Math.floor((now.getTime() - then.getTime()) / 1000);

    const thresholds = [
      { unit: "year", seconds: 31536000 },
      { unit: "month", seconds: 2592000 },
      { unit: "week", seconds: 604800 },
      { unit: "day", seconds: 86400 },
      { unit: "hour", seconds: 3600 },
      { unit: "minute", seconds: 60 },
      { unit: "second", seconds: 1 },
    ];

    for (const { unit, seconds } of thresholds) {
      const value = Math.floor(diffInSeconds / seconds);
      if (value >= 1) {
        return `${value} ${unit}${value !== 1 ? "s" : ""} ago`;
      }
    }

    return "just now";
  };

  return (
    <div
      className="video-item-root"
      tabIndex={0}
      onClick={(e) => {
        const target = e.target instanceof Element ? e.target : null;
        if (
          target?.closest(".copy-link") ||
          target?.closest(".more-actions") ||
          target?.closest(".video-item-select")
        ) {
          e.stopPropagation();
          return;
        }
        onOpen();
      }}
    >
      <div className="video-item">
        <div className="video-item-left">
          {onSelectToggle && (
            <input
              type="checkbox"
              className="video-item-select"
              checked={selected}
              aria-label={`Select ${title || "recording"}`}
              onChange={(e) => {
                e.stopPropagation();
                onSelectToggle();
              }}
              onClick={(e) => e.stopPropagation()}
            />
          )}
          {thumbnail && (
            <div
              className="video-item-thumbnail"
              style={{
                backgroundImage: `url(${thumbnail})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
          )}
          <div className="video-item-info">
            <div className="video-item-info-title">{title}</div>
            <div className="video-item-info-date">{formatRelativeTime(date)}</div>
            {meta && <div className="video-item-info-meta">{meta}</div>}
            {status && (
              <div
                className={`video-item-info-status ${
                  status.kind === "warning" ? "is-warning" : ""
                }`}
              >
                {status.label}
              </div>
            )}
          </div>
        </div>
        <div className="video-item-right">
          <button
            role="button"
            tabIndex={0}
            className="copy-link"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onCopyLink();
            }}
          >
            <img src={CopyLinkIcon} alt="Copy link" />
          </button>
          {onRename && (
            <button
              role="button"
              tabIndex={0}
              title="Rename"
              className="more-actions"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRename();
              }}
            >
              <img src={MoreActionsIcon} alt="Rename" />
            </button>
          )}
          {onDuplicate && (
            <button
              role="button"
              tabIndex={0}
              title="Duplicate"
              className="more-actions"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDuplicate();
              }}
            >
              <img src={MoreActionsIcon} alt="Duplicate" />
            </button>
          )}
          {onExport && (
            <button
              role="button"
              tabIndex={0}
              title="Export"
              className="more-actions"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onExport();
              }}
            >
              <img src={CopyLinkIcon} alt="Export" />
            </button>
          )}
          {onSaveToFile && (
            <button
              role="button"
              tabIndex={0}
              title="Save to file"
              className="more-actions"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSaveToFile();
              }}
            >
              S
            </button>
          )}
          {onRepair && (
            <button
              role="button"
              tabIndex={0}
              title="Repair"
              className="more-actions"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRepair();
              }}
            >
              !
            </button>
          )}
          {onDelete && (
            <button
              role="button"
              tabIndex={0}
              title="Delete"
              className="more-actions"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete();
              }}
            >
              ×
            </button>
          )}
          {/* <button
            role="button"
            tabIndex="0"
            title="More actions"
            className="more-actions"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <img src={MoreActionsIcon} alt="More actions" />
          </button> */}
        </div>
      </div>
    </div>
  );
};

export default VideoItem;

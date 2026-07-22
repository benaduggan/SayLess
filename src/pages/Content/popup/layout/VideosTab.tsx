import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import * as Tabs from "@radix-ui/react-tabs";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

import VideoItem from "../components/VideoItem";
import {
  CheckWhiteIcon,
  DropdownIcon,
  PlaceholderThumb,
} from "../../images/popup/images";
import { contentStateContext } from "../../context/ContentState";
import {
  cleanupLocalRecordingStorage,
  deleteLocalRecording,
  deleteLocalRecordings,
  duplicateLocalRecording,
  getLocalRecordingCaptionExport,
  getLocalRecordingCaptionExports,
  getLocalRecordingExport,
  getLocalRecordingExports,
  getLocalRecordingProjectExport,
  getLocalRecordingProjectExports,
  getLocalRecordingTranscriptExport,
  getLocalRecordingTranscriptExports,
  importLocalRecordingFile,
  importLocalRecordingProjectSidecar,
  inspectLocalRecording,
  inspectLocalRecordingStorage,
  listLocalRecordings,
  repairLocalRecording,
  renameLocalRecording,
} from "../../../localRecordings/localRecordingLibrary";
import { filterLocalVideos, LOCAL_VIDEO_FILTERS } from "./localVideoFilters";
import {
  hasFileSystemSavePicker,
  saveOrDownloadBlob,
} from "../../../utils/localFileExport";

const formatBytes = (value: unknown) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const amount = bytes / 1024 ** index;
  return `${
    amount >= 10 || index === 0 ? Math.round(amount) : amount.toFixed(1)
  } ${units[index]}`;
};

const formatDuration = (durationMs: unknown) => {
  const totalSeconds = Math.max(
    0,
    Math.round((Number(durationMs) || 0) / 1000)
  );
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
};

const storageLabel = (entry: any) =>
  entry.backendRef?.backend === "opfs"
    ? "OPFS"
    : entry.blobKey
    ? "IndexedDB"
    : "Local";

const storagePressureLabel = (pressure: any) => {
  if (pressure?.level === "critical") return "storage critical";
  if (pressure?.level === "near-limit") return "storage near limit";
  return null;
};

const assertLocalExtensionUrl = (url: unknown) => {
  const baseUrl = chrome.runtime.getURL("");
  if (typeof url !== "string" || !url.startsWith(baseUrl)) {
    throw new Error("Expected local extension URL.");
  }
  return url;
};

const formatLocalDate = (
  timestamp: string | number | Date | null | undefined
) => {
  if (!timestamp) return "Unknown date";
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "Unknown date";
  }
};

const buildRecordingMeta = (video: any) => {
  const parts = [
    formatDuration(video.durationMs),
    formatBytes(video.byteSize),
    formatLocalDate(video.createdAt || video.updatedAt),
    storageLabel(video),
  ];
  if (video.editedAt) parts.push("edited");
  if (video.project?.transcript) parts.push("transcript");
  return parts.join(" · ");
};

const VideosTab = (props: {
  shadowRef: React.RefObject<HTMLElement | null>;
}) => {
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [videos, setVideos] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [storageSummary, setStorageSummary] = useState<any>(null);
  const [recordingHealth, setRecordingHealth] = useState<Record<string, any>>(
    {}
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [contentState, setContentState] = useContext(contentStateContext);

  const sortBy = contentState.sortBy || "newest";

  const loadLocalVideos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const localVideos = await listLocalRecordings({ sortBy });
      setVideos(localVideos);
      setSelectedIds((prev) =>
        prev.filter((id) => localVideos.some((video) => video.id === id))
      );
      const [summary, inspections] = await Promise.all([
        inspectLocalRecordingStorage(),
        Promise.all(
          localVideos.map(async (video) => [
            video.id,
            await inspectLocalRecording(video.id),
          ])
        ),
      ]);
      setStorageSummary(summary);
      setRecordingHealth(Object.fromEntries(inspections));
    } catch (err) {
      console.error("Failed to load local recordings:", err);
      setError("Failed to load local recordings");
      setVideos([]);
      setStorageSummary(null);
      setRecordingHealth({});
    } finally {
      setLoading(false);
    }
  }, [sortBy]);

  useEffect(() => {
    loadLocalVideos();
  }, [loadLocalVideos]);

  useEffect(() => {
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      if (areaName !== "local") return;
      if (!changes.localRecordingLibraryIndex && !changes.sortBy) return;
      loadLocalVideos();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [loadLocalVideos]);

  const handleVideoClick = (videoId: string) => {
    const url = chrome.runtime.getURL(
      `editor.html?localRecordingId=${encodeURIComponent(videoId)}`
    );
    window.open(assertLocalExtensionUrl(url), "_blank");
  };

  const handleCopyLocalInfo = (video: any) => {
    const lines = [
      video.title || "Untitled recording",
      `Created: ${new Date(
        video.createdAt || video.updatedAt
      ).toLocaleString()}`,
      `Duration: ${Math.round((video.durationMs || 0) / 1000)}s`,
      `Size: ${video.byteSize || 0} bytes`,
      `Storage: ${
        video.backendRef?.backend || (video.blobKey ? "idb" : "local")
      }`,
    ];
    navigator.clipboard
      .writeText(lines.join("\n"))
      .then(() => {
        contentState.openToast?.("Recording details copied.", 3000);
      })
      .catch(() => {
        contentState.openToast?.("Could not copy recording details.", 3000);
      });
  };

  const handleRename = async (video: any) => {
    const nextTitle = window.prompt("Rename recording", video.title || "");
    if (nextTitle == null) return;
    const trimmed = nextTitle.trim();
    if (!trimmed || trimmed === video.title) return;
    try {
      await renameLocalRecording(video.id, trimmed);
      contentState.openToast?.("Recording renamed.", 2500);
      loadLocalVideos();
    } catch (err) {
      console.error("Failed to rename local recording:", err);
      contentState.openToast?.("Could not rename recording.", 3000);
    }
  };

  const handleDuplicate = async (video: any) => {
    try {
      await duplicateLocalRecording(video.id);
      contentState.openToast?.("Recording duplicated.", 2500);
      loadLocalVideos();
    } catch (err) {
      console.error("Failed to duplicate local recording:", err);
      contentState.openToast?.("Could not duplicate recording.", 3000);
    }
  };

  const handleExport = async (
    video: any,
    { preferPicker = false }: { preferPicker?: boolean } = {}
  ) => {
    try {
      const { blob, fileName } = await getLocalRecordingExport(video.id);
      await downloadBlob(blob, fileName, { preferPicker });
      const sidecar = await getLocalRecordingProjectExport(video.id);
      await downloadBlob(sidecar.blob, sidecar.fileName, { preferPicker });
      if (video.project?.transcript) {
        const transcript = await getLocalRecordingTranscriptExport(video.id);
        await downloadBlob(transcript.blob, transcript.fileName, {
          preferPicker,
        });
        const captions = await getLocalRecordingCaptionExport(video.id);
        await downloadBlob(captions.blob, captions.fileName, { preferPicker });
      }
      contentState.openToast?.(
        preferPicker ? "Export saved." : "Export started.",
        2500
      );
    } catch (err) {
      console.error("Failed to export local recording:", err);
      contentState.openToast?.("Could not export recording.", 3000);
    }
  };

  const downloadBlob = async (
    blob: Blob,
    fileName: string,
    { preferPicker = false }: { preferPicker?: boolean } = {}
  ) => saveOrDownloadBlob(blob, fileName, { preferPicker });

  const handleBulkExport = async ({ preferPicker = false } = {}) => {
    try {
      const exportableIds = selectedIds.filter(
        (id) => recordingHealth[id]?.ok !== false
      );
      const exports = await getLocalRecordingExports(exportableIds);
      for (const item of exports) {
        await downloadBlob(item.blob, item.fileName, { preferPicker });
      }
      const sidecars = await getLocalRecordingProjectExports(exportableIds);
      for (const item of sidecars) {
        await downloadBlob(item.blob, item.fileName, { preferPicker });
      }
      const transcripts = await getLocalRecordingTranscriptExports(
        exportableIds
      );
      for (const item of transcripts) {
        await downloadBlob(item.blob, item.fileName, { preferPicker });
      }
      const captions = await getLocalRecordingCaptionExports(exportableIds);
      for (const item of captions) {
        await downloadBlob(item.blob, item.fileName, { preferPicker });
      }
      const sidecarCount =
        sidecars.length + transcripts.length + captions.length;
      const exportMessage = preferPicker
        ? `${exports.length} media ${
            exports.length === 1 ? "export" : "exports"
          } saved.`
        : exports.length === 1
        ? "Export started."
        : `${exports.length} media exports started${
            sidecarCount ? ` with ${sidecarCount} sidecars` : ""
          }.`;
      contentState.openToast?.(exportMessage, 2500);
    } catch (err) {
      console.error("Failed to export selected recordings:", err);
      contentState.openToast?.("Could not export selected recordings.", 3000);
    }
  };

  const handleBulkDelete = async () => {
    if (!selectedIds.length) return;
    const ok = window.confirm(
      `Delete ${selectedIds.length} selected ${
        selectedIds.length === 1 ? "recording" : "recordings"
      } from this device?`
    );
    if (!ok) return;
    try {
      const result = await deleteLocalRecordings(selectedIds);
      setSelectedIds([]);
      contentState.openToast?.(
        `Deleted ${result.deletedCount} ${
          result.deletedCount === 1 ? "recording" : "recordings"
        }.`,
        2500
      );
      loadLocalVideos();
    } catch (err) {
      console.error("Failed to delete selected recordings:", err);
      contentState.openToast?.("Could not delete selected recordings.", 3000);
    }
  };

  const handleRepair = async (video: any) => {
    const ok = window.confirm(
      `Remove the broken local entry for "${
        video.title || "Untitled recording"
      }"?`
    );
    if (!ok) return;
    try {
      const result = await repairLocalRecording(video.id);
      contentState.openToast?.(
        result.repaired ? "Broken entry removed." : "Recording is healthy.",
        2500
      );
      loadLocalVideos();
    } catch (err) {
      console.error("Failed to repair local recording:", err);
      contentState.openToast?.("Could not repair recording.", 3000);
    }
  };

  const handleImportClick = () => {
    importInputRef.current?.click();
  };

  const handleImportFiles = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    try {
      let importedCount = 0;
      let projectCount = 0;
      for (const file of files) {
        if (/\.sayless-project\.json$/i.test(file.name || "")) {
          await importLocalRecordingProjectSidecar(file);
          projectCount += 1;
        } else {
          await importLocalRecordingFile(file);
          importedCount += 1;
        }
      }
      contentState.openToast?.(
        projectCount
          ? `${projectCount} project ${
              projectCount === 1 ? "sidecar" : "sidecars"
            } imported.`
          : importedCount === 1
          ? "Recording imported."
          : `${importedCount} recordings imported.`,
        2500
      );
      loadLocalVideos();
    } catch (err) {
      console.error("Failed to import local recording:", err);
      contentState.openToast?.("Could not import recording.", 3000);
    }
  };

  const handleCleanupStorage = async () => {
    const orphanCount = storageSummary?.orphanCount || 0;
    if (!orphanCount) return;
    const ok = window.confirm(
      `Remove ${orphanCount} unreferenced local media ${
        orphanCount === 1 ? "file" : "files"
      }?`
    );
    if (!ok) return;
    try {
      const result = await cleanupLocalRecordingStorage();
      contentState.openToast?.(
        result.removedCount
          ? `Removed ${result.removedCount} unreferenced media ${
              result.removedCount === 1 ? "file" : "files"
            }.`
          : "No cleanup needed.",
        3000
      );
      loadLocalVideos();
    } catch (err) {
      console.error("Failed to clean local recording storage:", err);
      contentState.openToast?.("Could not clean local storage.", 3000);
    }
  };

  const handleDelete = async (video: any) => {
    const ok = window.confirm(
      `Delete "${video.title || "Untitled recording"}" from this device?`
    );
    if (!ok) return;
    try {
      await deleteLocalRecording(video.id);
      setSelectedIds((prev) => prev.filter((id) => id !== video.id));
      contentState.openToast?.("Recording deleted.", 2500);
      loadLocalVideos();
    } catch (err) {
      console.error("Failed to delete local recording:", err);
      contentState.openToast?.("Could not delete recording.", 3000);
    }
  };

  const sortLabelMap = {
    newest: chrome.i18n.getMessage("newestSortLabel") || "Newest",
    oldest: chrome.i18n.getMessage("oldestSortLabel") || "Oldest",
    alphabetical: "A-Z",
    "reverse-alphabetical": "Z-A",
  };

  const selectedExportableCount = selectedIds.filter(
    (id) => recordingHealth[id]?.ok !== false
  ).length;
  const pressureLabel = storagePressureLabel(storageSummary?.pressure);
  const canSaveToFile = hasFileSystemSavePicker();
  const visibleVideos = filterLocalVideos(videos, {
    query: searchQuery,
    filters: activeFilters,
    healthById: recordingHealth,
  });
  const hasLibraryFilters =
    searchQuery.trim().length > 0 || activeFilters.length > 0;

  const toggleSelected = (videoId: string) => {
    setSelectedIds((prev) =>
      prev.includes(videoId)
        ? prev.filter((id) => id !== videoId)
        : [...prev, videoId]
    );
  };

  const toggleFilter = (filterId: string) => {
    setActiveFilters((prev) =>
      prev.includes(filterId)
        ? prev.filter((id) => id !== filterId)
        : [...prev, filterId]
    );
  };

  return (
    <div className="video-ui">
      <Tabs.Root className="TabsRoot" defaultValue="personal">
        <Tabs.List className="TabsList" aria-label="Local recordings">
          <div className="TabsTriggerWrap">
            <Tabs.Trigger className="TabsTrigger" value="personal">
              <div className="TabsTriggerLabel">
                <span>{chrome.i18n.getMessage("allVideosHeading")}</span>
              </div>
            </Tabs.Trigger>
          </div>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button className="TabsSort" aria-label="Sort videos">
                <div className="TabsSortLabel">
                  {sortLabelMap[sortBy as keyof typeof sortLabelMap] || "Sort"}{" "}
                  <img src={DropdownIcon} />
                </div>
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal
              container={
                props.shadowRef.current?.shadowRoot?.querySelector(
                  ".container"
                ) || undefined
              }
            >
              <DropdownMenu.Content
                className="DropdownMenuContent"
                sideOffset={4}
                align="end"
              >
                <DropdownMenu.RadioGroup
                  value={sortBy}
                  onValueChange={(value) => {
                    setContentState((prev) => ({ ...prev, sortBy: value }));
                    chrome.storage.local.set({ sortBy: value });
                  }}
                >
                  {Object.entries(sortLabelMap).map(([value, label]) => (
                    <DropdownMenu.RadioItem
                      key={value}
                      className="DropdownMenuItem"
                      value={value}
                    >
                      {label}
                      <DropdownMenu.ItemIndicator className="ItemIndicator">
                        <img src={CheckWhiteIcon} />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </Tabs.List>

        <Tabs.Content className="TabsContent" value="personal">
          <div className="videos-list">
            <input
              ref={importInputRef}
              className="local-import-input"
              type="file"
              accept="video/*"
              multiple
              onChange={handleImportFiles}
            />
            {storageSummary && (
              <div className="local-storage-panel">
                <div>
                  <strong>{storageSummary.count}</strong>
                  <span>local recordings</span>
                </div>
                <div>
                  <strong>{formatBytes(storageSummary.indexedBytes)}</strong>
                  <span>indexed media</span>
                </div>
                {storageSummary.usage != null &&
                  storageSummary.quota != null && (
                    <div>
                      <strong>
                        {formatBytes(storageSummary.usage)} /{" "}
                        {formatBytes(storageSummary.quota)}
                      </strong>
                      <span>browser storage</span>
                    </div>
                  )}
                {storageSummary.orphanCount > 0 && (
                  <div className="local-storage-warning">
                    <strong>{storageSummary.orphanCount}</strong>
                    <span>unreferenced media</span>
                  </div>
                )}
                {pressureLabel && (
                  <div
                    className={`local-storage-warning ${
                      storageSummary.pressure.level === "critical"
                        ? "is-critical"
                        : ""
                    }`}
                  >
                    <strong>
                      {Math.round((storageSummary.pressure.ratio || 0) * 100)}%
                    </strong>
                    <span>{pressureLabel}</span>
                  </div>
                )}
                {storageSummary.orphanCount > 0 && (
                  <button type="button" onClick={handleCleanupStorage}>
                    Clean up
                  </button>
                )}
                <button type="button" onClick={handleImportClick}>
                  Import
                </button>
              </div>
            )}
            <div className="local-library-controls">
              <label className="local-search-field">
                <span>Search local recordings</span>
                <input
                  type="search"
                  value={searchQuery}
                  placeholder="Search title, transcript, storage"
                  onChange={(event) => setSearchQuery(event.target.value)}
                />
              </label>
              <div className="local-filter-row" aria-label="Filter recordings">
                {LOCAL_VIDEO_FILTERS.map((filter) => {
                  const active = activeFilters.includes(filter.id);
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      className={active ? "is-active" : ""}
                      aria-pressed={active}
                      onClick={() => toggleFilter(filter.id)}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>
              <div className="local-result-count">
                {visibleVideos.length} of {videos.length} local recordings
              </div>
            </div>
            {error && <p>{error}</p>}
            {selectedIds.length > 0 && (
              <div className="local-bulk-toolbar">
                <span>{selectedIds.length} selected</span>
                <button
                  type="button"
                  disabled={selectedExportableCount === 0}
                  onClick={() => handleBulkExport()}
                >
                  Export
                </button>
                {canSaveToFile && (
                  <button
                    type="button"
                    disabled={selectedExportableCount === 0}
                    onClick={() => handleBulkExport({ preferPicker: true })}
                  >
                    Save to...
                  </button>
                )}
                <button type="button" onClick={handleBulkDelete}>
                  Delete
                </button>
                <button type="button" onClick={() => setSelectedIds([])}>
                  Clear
                </button>
              </div>
            )}
            {videos.length === 0 && !loading && !error && (
              <div className="empty-state">
                <span>{chrome.i18n.getMessage("noVideosFound")}</span>
              </div>
            )}
            {videos.length > 0 &&
              visibleVideos.length === 0 &&
              !loading &&
              !error && (
                <div className="empty-state">
                  <span>
                    {hasLibraryFilters
                      ? "No local recordings match these filters."
                      : chrome.i18n.getMessage("noVideosFound")}
                  </span>
                </div>
              )}
            {(visibleVideos as any[]).map((video: any) => {
              const health = recordingHealth[video.id];
              const isBroken = health && !health.ok;
              return (
                <VideoItem
                  key={video.id}
                  title={video.title}
                  date={video.createdAt || video.updatedAt}
                  selected={selectedIds.includes(video.id)}
                  onSelectToggle={() => toggleSelected(video.id)}
                  meta={buildRecordingMeta(video)}
                  status={
                    isBroken
                      ? {
                          kind: "warning",
                          label: `Missing media: ${health.status}`,
                        }
                      : undefined
                  }
                  thumbnail={video.thumbnailDataUrl || PlaceholderThumb}
                  onOpen={() => handleVideoClick(video.id)}
                  onCopyLink={() => handleCopyLocalInfo(video)}
                  onRename={() => handleRename(video)}
                  onDuplicate={
                    isBroken ? undefined : () => handleDuplicate(video)
                  }
                  onExport={isBroken ? undefined : () => handleExport(video)}
                  onSaveToFile={
                    isBroken || !canSaveToFile
                      ? undefined
                      : () => handleExport(video, { preferPicker: true })
                  }
                  onRepair={isBroken ? () => handleRepair(video) : undefined}
                  onDelete={() => handleDelete(video)}
                />
              );
            })}
            {loading && (
              <div className="spinner-container">
                <div className="spinner" />
                <span>{chrome.i18n.getMessage("loadingVideosLabel")}</span>
              </div>
            )}
          </div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
};

export default VideosTab;

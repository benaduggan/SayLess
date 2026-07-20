import React, { useCallback, useEffect, useRef } from "react";
import { collectMediaPermissionResult } from "./mediaPermissions";

const Recorder = () => {
  const permissionStatusesRef = useRef([]);
  const checkingRef = useRef(false);
  const pendingCheckRef = useRef(null);

  const publishPermissions = useCallback(async (options = {}) => {
    if (checkingRef.current) {
      if (options.request || !pendingCheckRef.current) {
        pendingCheckRef.current = options;
      }
      return;
    }
    checkingRef.current = true;
    try {
      const result = await collectMediaPermissionResult(options);
      await chrome.storage.local.set({
        audioinput: result.audioinput,
        audiooutput: result.audiooutput,
        videoinput: result.videoinput,
        cameraPermission: result.cameraPermission,
        microphonePermission: result.microphonePermission,
        cameraPermissionState: result.cameraPermissionState,
        microphonePermissionState: result.microphonePermissionState,
      });
      window.parent.postMessage(
        { type: "screenity-permissions", ...result },
        "*"
      );
    } catch (error) {
      window.parent.postMessage(
        {
          type: "screenity-permissions",
          success: false,
          error: error?.name || "unknown",
        },
        "*"
      );
    } finally {
      checkingRef.current = false;
      const pendingCheck = pendingCheckRef.current;
      pendingCheckRef.current = null;
      if (pendingCheck) {
        queueMicrotask(() => publishPermissions(pendingCheck));
      }
    }
  }, []);

  useEffect(() => {
    window.parent.postMessage(
      {
        type: "screenity-permissions-loaded",
      },
      "*"
    );
  }, []);

  useEffect(() => {
    const handleDeviceChange = () => publishPermissions();

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener(
        "devicechange",
        handleDeviceChange
      );
    };
  }, [publishPermissions]);

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      ["camera", "microphone"].map(async (name) => {
        try {
          return await navigator.permissions.query({ name });
        } catch {
          return null;
        }
      })
    ).then((statuses) => {
      if (cancelled) return;
      permissionStatusesRef.current = statuses.filter(Boolean);
      permissionStatusesRef.current.forEach((status) => {
        status.onchange = publishPermissions;
      });
    });

    const handleMessage = (event) => {
      if (event.source !== window.parent) return;
      if (event.data?.type === "screenity-get-permissions") {
        publishPermissions();
      } else if (event.data?.type === "screenity-request-permissions") {
        publishPermissions({
          request: true,
          requestedTypes: event.data.mediaTypes,
        });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => {
      cancelled = true;
      permissionStatusesRef.current.forEach((status) => {
        status.onchange = null;
      });
      window.removeEventListener("message", handleMessage);
    };
  }, [publishPermissions]);

  return <div></div>;
};

export default Recorder;

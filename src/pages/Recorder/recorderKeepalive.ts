// Keep-alive bootstrap. Loads pre-bundle to dodge Chrome's background-tab
// throttle on region recordings. Handles hang off window.__SAYLESS_KEEPALIVE.
export {};

interface KeepaliveHandles {
  startedAt?: number;
  completedAt?: number;
  audioCtx?: AudioContext | null;
  silentAudio?: HTMLAudioElement | null;
  oscillator?: OscillatorNode | null;
  lockAbort?: AbortController | null;
  priorityPc1?: RTCPeerConnection | null;
  priorityPc2?: RTCPeerConnection | null;
  priorityCanvas?: HTMLCanvasElement | null;
  priorityTrack?: MediaStreamTrack | null;
  priorityTick?: ReturnType<typeof setInterval> | null;
  mediaSession?: boolean;
}

declare global {
  interface Window {
    __SAYLESS_KEEPALIVE?: KeepaliveHandles;
    webkitAudioContext?: typeof AudioContext;
  }
}

(function () {
  try {
    const KA = (window.__SAYLESS_KEEPALIVE = window.__SAYLESS_KEEPALIVE || {});
    KA.startedAt = Date.now();
    try {
      performance.mark("sayless-keepalive-start");
    } catch (e) {}

    // Silent ultrasonic sine; counts as "playing audio" to Chrome.
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !KA.audioCtx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 20000;
        gain.gain.value = 0.0001;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        // AudioContext starts suspended without a user gesture; without
        // resume() the oscillator emits nothing and Chrome doesn't
        // count it (diag showed 6.5s mid-recording freezes).
        if (ctx.state !== "running") {
          ctx.resume().catch(function () {});
        }
        KA.audioCtx = ctx;
        KA.oscillator = osc;
      }
    } catch (e) {}

    // Hold an exclusive lock; signals "doing work" to Chrome.
    try {
      if (navigator.locks && !KA.lockAbort) {
        const ac = new AbortController();
        KA.lockAbort = ac;
        navigator.locks
          .request(
            "sayless-recorder-keepalive",
            { mode: "exclusive", signal: ac.signal },
            function () {
              return new Promise<void>(function () {});
            },
          )
          .catch(function () {});
      }
    } catch (e) {}

    // Loopback PC with a live video track marks the tab "in a call" so
    // Chrome keeps the renderer at foreground priority. Host-only ICE.
    try {
      if (typeof RTCPeerConnection === "function" && !KA.priorityPc1) {
        const bcanvas = document.createElement("canvas");
        bcanvas.width = 2;
        bcanvas.height = 2;
        const bctx = bcanvas.getContext("2d");
        if (bctx) bctx.fillRect(0, 0, 2, 2);
        // captureStream(0) → no automatic frames; we tick manually so
        // the track stays "live" without burning CPU on capture.
        const bstream = bcanvas.captureStream ? bcanvas.captureStream(0) : null;
        const btrack = bstream
          ? (bstream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined)
          : null;
        if (btrack && bstream) {
          const pc1 = new RTCPeerConnection();
          const pc2 = new RTCPeerConnection();
          KA.priorityPc1 = pc1;
          KA.priorityPc2 = pc2;
          KA.priorityCanvas = bcanvas;
          KA.priorityTrack = btrack;
          pc1.onicecandidate = function (e) {
            if (e.candidate) pc2.addIceCandidate(e.candidate).catch(function () {});
          };
          pc2.onicecandidate = function (e) {
            if (e.candidate) pc1.addIceCandidate(e.candidate).catch(function () {});
          };
          pc1.addTrack(btrack, bstream);
          pc1
            .createOffer()
            .then(function (offer) {
              return pc1.setLocalDescription(offer).then(function () {
                return pc2.setRemoteDescription(offer);
              });
            })
            .then(function () {
              return pc2.createAnswer();
            })
            .then(function (answer) {
              return pc2.setLocalDescription(answer).then(function () {
                return pc1.setRemoteDescription(answer);
              });
            })
            .catch(function () {});
          // Periodic 1×1 redraw keeps the captureStream track from
          // being marked ended after the first frame is consumed.
          KA.priorityTick = setInterval(function () {
            try {
              if (bctx) {
                bctx.fillStyle = bctx.fillStyle === "#000" ? "#001" : "#000";
                bctx.fillRect(0, 0, 2, 2);
              }
              if (bstream && typeof bstream.getVideoTracks === "function") {
                const t = bstream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
                t?.requestFrame();
              }
            } catch (e) {}
          }, 2000);
        }
      }
    } catch (e) {}

    try {
      if (navigator.mediaSession && !KA.mediaSession) {
        if (typeof MediaMetadata === "function") {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: "SayLess recording",
            artist: "SayLess",
          });
        }
        navigator.mediaSession.playbackState = "playing";
        try {
          navigator.mediaSession.setActionHandler("pause", function () {});
        } catch (e) {}
        KA.mediaSession = true;
      }
    } catch (e) {}

    KA.completedAt = Date.now();
    try {
      performance.mark("sayless-keepalive-end");
    } catch (e) {}
  } catch (e) {}
})();

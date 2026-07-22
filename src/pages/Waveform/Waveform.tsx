import React, { useEffect, useRef } from "react";

const Waveform = (): React.JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const canvasContext = canvas.getContext("2d");
    if (!canvasContext) return;
    const activeCanvas: HTMLCanvasElement = canvas;
    const activeContext: CanvasRenderingContext2D = canvasContext;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let dataArray: Float32Array<ArrayBuffer> | null = null;
    let animationFrameId: number | null = null;
    let audioStream: MediaStream | null = null;

    function initializeAudioContext(): void {
      if (!audioContext) {
        audioContext = new AudioContext();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 2048;
        analyser.maxDecibels = -60;
        dataArray = new Float32Array(analyser.fftSize);
        const source = audioContext.createMediaStreamDestination();
        analyser.connect(source);
        audioContext.resume();
        startVisualization();
      }
    }

    function startVisualization(): void {
      if (!analyser || !dataArray) return;
      analyser.getFloatTimeDomainData(dataArray);
      activeContext.clearRect(0, 0, activeCanvas.width, activeCanvas.height);
      activeContext.beginPath();
      const sliceWidth = 0.7;
      const waveformHeight = activeCanvas.height * 0.9;
      const waveformOffset = (activeCanvas.height - waveformHeight) / 2;
      let x = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const v = (dataArray[i] + 1) / 2;
        const y = v * waveformHeight + waveformOffset;
        if (i === 0) {
          activeContext.moveTo(x, y);
        } else {
          activeContext.lineTo(x, y);
        }
        x += sliceWidth;
      }
      activeContext.strokeStyle = "#78C072";
      activeContext.lineWidth = 1.5;
      activeContext.stroke();

      animationFrameId = requestAnimationFrame(startVisualization);
    }

    function stopVisualization(): void {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    }

    function startAudioCapture(): void {
      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then((stream) => {
          audioStream = stream;
          initializeAudioContext();
          if (!audioContext || !analyser) return;
          const audioSource = audioContext.createMediaStreamSource(audioStream);
          audioSource.connect(analyser);
        })
        .catch((error) => {
          console.error("Error capturing audio:", error);
        });
    }

    function stopAudioCapture(): void {
      if (audioStream) {
        const tracks = audioStream.getTracks();
        tracks.forEach((track) => track.stop());
        audioStream = null;
        stopVisualization();
      }
      void audioContext?.close().catch(() => {});
      audioContext = null;
    }

    startAudioCapture();

    return () => {
      stopAudioCapture();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width="324"
      height="30"
      style={{ background: "#f5f6fa" }}
    />
  );
};

export default Waveform;

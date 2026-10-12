"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";

export interface FaceData {
  box: [number, number, number, number];
  match: { user_id: string; name: string } | null;
  confidence?: number;
}

export interface CapturedFaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BrowserFaceDetection {
  box: { x: number; y: number; width: number; height: number };
}

interface BrowserFaceApi {
  nets: { tinyFaceDetector: { loadFromUri: (path: string) => Promise<unknown> } };
  TinyFaceDetectorOptions: new (options: { inputSize: number; scoreThreshold: number }) => object;
  detectAllFaces: (video: HTMLVideoElement, options: object) => Promise<BrowserFaceDetection[]>;
}

interface CameraCaptureProps {
  onCapture: (dataUrl: string, faceBoxes: CapturedFaceBox[]) => void;
  captureIntervalMs?: number | null;
  singleShot?: boolean;
  isLiveMode?: boolean;
  facesData?: FaceData[];
}

let browserFaceApiPromise: Promise<BrowserFaceApi> | null = null;

function loadBrowserFaceApi(): Promise<BrowserFaceApi> {
  if (!browserFaceApiPromise) {
    browserFaceApiPromise = (async () => {
      const api = (await import("@vladmandic/face-api")) as unknown as BrowserFaceApi;
      await api.nets.tinyFaceDetector.loadFromUri("/models");
      return api;
    })();
  }
  return browserFaceApiPromise;
}

function canvasToDataUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to encode camera frame"));
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Unable to read encoded camera frame"));
      };
      reader.onerror = () => reject(reader.error ?? new Error("Unable to read camera frame"));
      reader.readAsDataURL(blob);
    }, "image/jpeg", 0.65);
  });
}

const CameraCapture: React.FC<CameraCaptureProps> = ({
  onCapture,
  captureIntervalMs = null,
  singleShot = false,
  isLiveMode = false,
  facesData = [],
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const captureInProgressRef = useRef(false);
  const captureFunctionRef = useRef<() => Promise<void>>(async () => {});
  const captureSizeRef = useRef({ width: 360, height: 270 });
  const liveFaceBoxesRef = useRef<CapturedFaceBox[]>([]);
  const recognitionRef = useRef({ faces: facesData, updatedAt: 0 });
  const [cameraStatus, setCameraStatus] = useState<"loading" | "active" | "stopped">("stopped");
  const [cameraError, setCameraError] = useState<string>("");
  const cameraStatusRef = useRef(cameraStatus);
  const onCaptureRef = useRef(onCapture);

  useEffect(() => {
    cameraStatusRef.current = cameraStatus;
    onCaptureRef.current = onCapture;
  }, [cameraStatus, onCapture]);

  useEffect(() => {
    recognitionRef.current = { faces: facesData, updatedAt: Date.now() };
  }, [facesData]);

  const startCamera = async () => {
    try {
      setCameraStatus("loading");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraStatus("active");
    } catch (err) {
      console.error("Camera error:", err);
      setCameraError("Failed to access camera.");
      setCameraStatus("stopped");
    }
  };

  const stopCamera = () => {
    const stream = videoRef.current?.srcObject as MediaStream;
    stream?.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    if (intervalRef.current) clearInterval(intervalRef.current);
    setCameraStatus("stopped");
  };

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || cameraStatusRef.current !== "active" || captureInProgressRef.current) return;

    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    if (!videoWidth || !videoHeight) return;

    captureInProgressRef.current = true;
    try {
      const scale = Math.min(1, 360 / Math.max(videoWidth, videoHeight));
      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = Math.round(videoWidth * scale);
      captureCanvas.height = Math.round(videoHeight * scale);
      captureSizeRef.current = { width: captureCanvas.width, height: captureCanvas.height };

      const context = captureCanvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

      const scaleX = captureCanvas.width / videoWidth;
      const scaleY = captureCanvas.height / videoHeight;
      const faceBoxes = liveFaceBoxesRef.current.map((box) => ({
        x: box.x * scaleX,
        y: box.y * scaleY,
        width: box.width * scaleX,
        height: box.height * scaleY,
      }));
      const dataUrl = await canvasToDataUrl(captureCanvas);
      await onCaptureRef.current(dataUrl, faceBoxes);
    } catch (error) {
      console.error("Camera capture failed:", error);
    } finally {
      captureInProgressRef.current = false;
    }
  }, []);

  useEffect(() => {
    captureFunctionRef.current = capture;
  }, [capture]);

  useEffect(() => {
    if (cameraStatus !== "active") return;

    let active = true;
    let timeoutId: number | undefined;

    const startTracking = async () => {
      try {
        const api = await loadBrowserFaceApi();
        const detectFrame = async () => {
          if (!active) return;

          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (video && canvas && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
            const detections = await api.detectAllFaces(
              video,
              new api.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 }),
            );

            if (!active) return;
            liveFaceBoxesRef.current = detections.map(({ box }) => box);
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext("2d");
            if (!context) return;
            context.clearRect(0, 0, canvas.width, canvas.height);

            const currentRecognition = recognitionRef.current;
            const recentMatches = Date.now() - currentRecognition.updatedAt < 5000
              ? currentRecognition.faces.filter((face) => face.match)
              : [];
            let bestMatch: FaceData | undefined;
            let bestDetectionIndex = -1;
            let bestDistance = Number.POSITIVE_INFINITY;
            const scaleX = video.videoWidth / captureSizeRef.current.width;
            const scaleY = video.videoHeight / captureSizeRef.current.height;

            for (const face of recentMatches) {
              const [x, y, width, height] = face.box;
              const faceCenterX = (x + width / 2) * scaleX;
              const faceCenterY = (y + height / 2) * scaleY;
              detections.forEach((detection, detectionIndex) => {
                const box = detection.box;
                const distance = Math.hypot(
                  faceCenterX - (box.x + box.width / 2),
                  faceCenterY - (box.y + box.height / 2),
                );
                if (distance < bestDistance) {
                  bestDistance = distance;
                  bestMatch = face;
                  bestDetectionIndex = detectionIndex;
                }
              });
            }

            const hasCurrentMatch = bestMatch && bestDistance < Math.max(video.videoWidth, video.videoHeight) * 0.4;
            detections.forEach((detection, detectionIndex) => {
              const box = detection.box;
              const matched = Boolean(
                hasCurrentMatch && detectionIndex === bestDetectionIndex && bestMatch?.match,
              );
              context.strokeStyle = matched ? "lime" : "red";
              context.lineWidth = 3;
              context.strokeRect(box.x, box.y, box.width, box.height);
              context.fillStyle = matched ? "lime" : "red";
              context.font = "16px Arial";
              context.fillText(matched ? bestMatch?.match?.name ?? "Unknown" : "Unknown", box.x, box.y - 5);
            });
          }

          if (active) timeoutId = window.setTimeout(() => void detectFrame(), 120);
        };

        void detectFrame();
      } catch (error) {
        console.error("Local face tracking failed:", error);
      }
    };

    void startTracking();
    return () => {
      active = false;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [cameraStatus]);

  useEffect(() => {
    if (singleShot || isLiveMode) startCamera();
    return () => stopCamera();
  }, [singleShot, isLiveMode]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (captureIntervalMs && isLiveMode && cameraStatus === "active") {
      intervalRef.current = setInterval(() => {
        void captureFunctionRef.current();
      }, captureIntervalMs);
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [captureIntervalMs, isLiveMode, cameraStatus]);

  return (
    <div className="relative w-full max-w-md">
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        className={`rounded-lg shadow-md w-full ${cameraStatus === "active" ? "block" : "hidden"}`}
        style={{ maxHeight: "360px" }}
      />
      <canvas ref={canvasRef} className="absolute top-0 left-0 rounded-lg w-full" />
      {cameraStatus === "stopped" && !cameraError && (
        <button
          onClick={startCamera}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-blue-600 text-white px-4 py-2 rounded"
        >
          Start Camera
        </button>
      )}
      {cameraError && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-red-600">
          {cameraError}
        </div>
      )}
    </div>
  );
};

export default CameraCapture;

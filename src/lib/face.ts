// Reconhecimento facial no navegador (MediaPipe, modelo BlazeFace). Roda na câmera ao vivo durante a
// gravação, guardando onde está o rosto ao longo do tempo. Na edição, isso serve para a legenda e os
// títulos nunca cobrirem o rosto e para o zoom centralizar nele.
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

/** Caixa do rosto normalizada (0–1) no quadro original da câmera, no instante `t` da gravação. */
export type FaceBox = { t: number; x: number; y: number; w: number; h: number };

const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

let detector: Promise<FaceDetector> | null = null;

export function loadFaceDetector() {
  detector ??= FilesetResolver.forVisionTasks("/mediapipe").then((files) =>
    FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate: "GPU" }, runningMode: "VIDEO", minDetectionConfidence: 0.5 }),
  );
  return detector;
}

/** Amostra o rosto do vídeo ao vivo a cada `every` ms até `stop()`; devolve a trilha gravada. */
export async function trackFaces(video: HTMLVideoElement, elapsed: () => number, every = 200) {
  const faces: FaceBox[] = [];
  let timer = 0;
  try {
    const d = await loadFaceDetector();
    timer = window.setInterval(() => {
      if (!video.videoWidth || video.readyState < 2) return;
      const box = d.detectForVideo(video, performance.now()).detections[0]?.boundingBox;
      if (box) faces.push({ t: elapsed(), x: box.originX / video.videoWidth, y: box.originY / video.videoHeight, w: box.width / video.videoWidth, h: box.height / video.videoHeight });
    }, every);
  } catch (e) {
    console.warn("[rosto] detector indisponível:", e);
  }
  return { faces, stop: () => clearInterval(timer) };
}

/** Rosto médio em ±0,4 s de `t` (suaviza o tremor da detecção); `null` se não houver rosto perto. */
export function faceAt(faces: FaceBox[], t: number): Omit<FaceBox, "t"> | null {
  const near = faces.filter((f) => Math.abs(f.t - t) <= 0.4);
  if (!near.length) return null;
  const avg = (k: "x" | "y" | "w" | "h") => near.reduce((s, f) => s + f[k], 0) / near.length;
  return { x: avg("x"), y: avg("y"), w: avg("w"), h: avg("h") };
}

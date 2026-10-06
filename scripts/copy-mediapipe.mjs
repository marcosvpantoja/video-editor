// Copia o runtime WebAssembly do MediaPipe para public/ (servido pelo próprio app; a CDN não
// entrega o .wasm de 11 MB). Roda no postinstall; a pasta de destino fica fora do git.
import { cpSync, existsSync } from "node:fs";

const from = "node_modules/@mediapipe/tasks-vision/wasm";
if (existsSync(from)) cpSync(from, "public/mediapipe", { recursive: true });

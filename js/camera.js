const VIDEO = { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } };
const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

// Abre la cámara frontal con micrófono; si el micrófono falla, sigue solo con video.
export async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    const err = new Error('Este navegador no permite usar la cámara (hace falta HTTPS).');
    err.name = 'NoMediaDevices';
    throw err;
  }
  try {
    return { stream: await navigator.mediaDevices.getUserMedia({ video: VIDEO, audio: AUDIO }), audio: true };
  } catch (e) {
    if (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError') {
      try {
        return { stream: await navigator.mediaDevices.getUserMedia({ video: VIDEO }), audio: false };
      } catch { /* sin cámara tampoco: devolvemos el error original */ }
    }
    throw e;
  }
}

// Micrófono nuevo (se pide antes de cada toma: en iPhone, cuando se corta el reconocimiento
// de voz, el micrófono de la toma anterior puede quedar apagado).
export async function openMic() {
  const s = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
  return s.getAudioTracks()[0];
}

const TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMime() {
  if (!window.MediaRecorder?.isTypeSupported) return '';
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export class Recorder {
  constructor(stream) {
    this.stream = stream;
    this.mime = pickMime();
    this.chunks = [];
  }

  start() {
    const opts = { videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 };
    if (this.mime) opts.mimeType = this.mime;
    this.mr = new MediaRecorder(this.stream, opts);
    this.mr.ondataavailable = (e) => { if (e.data?.size) this.chunks.push(e.data); };
    this.mr.start(1000);
  }

  stop() {
    return new Promise((resolve) => {
      const type = (this.mr.mimeType || this.mime || 'video/mp4');
      this.mr.onstop = () => resolve(new Blob(this.chunks, { type }));
      if (this.mr.state === 'inactive') this.mr.onstop();
      else this.mr.stop();
    });
  }
}

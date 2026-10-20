import { pickMime } from './camera.js?v=3.1';

// Une las partes elegidas de varias tomas en un solo video, en el teléfono.
// No hay librerías de video en la web: se reproduce cada parte y se vuelve a grabar
// (imagen en un canvas + sonido por Web Audio). Tarda lo mismo que dura el video final.
//
// createRenderer() tiene que llamarse dentro del toque del usuario: iOS solo deja
// reproducir con sonido y arrancar el audio en ese momento.
export function createRenderer(firstUrl) {
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.style.cssText = 'position:fixed;left:-4px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  document.body.append(video);

  const AC = window.AudioContext || window.webkitAudioContext;
  const actx = new AC();
  actx.resume?.().catch(() => {});
  const dest = actx.createMediaStreamDestination();
  actx.createMediaElementSource(video).connect(dest); // el sonido va al archivo, no al parlante

  video.src = firstUrl;
  video.play().then(() => video.pause()).catch(() => {});

  let cancelled = false;

  const once = (ev) => new Promise((resolve, reject) => {
    const ok = () => { video.removeEventListener('error', bad); resolve(); };
    const bad = () => { video.removeEventListener(ev, ok); reject(new Error('No pude leer una de las tomas.')); };
    video.addEventListener(ev, ok, { once: true });
    video.addEventListener('error', bad, { once: true });
  });

  async function load(url) {
    if (video.src === url && video.readyState >= 1) return;
    const ready = once('loadedmetadata');
    video.src = url;
    await ready;
  }

  async function seek(t) {
    if (Math.abs(video.currentTime - t) < 0.02) return;
    const done = once('seeked');
    video.currentTime = t;
    await done;
  }

  // parts: [{ url, start, end }] en segundos. onProgress(0..1). Devuelve un Blob.
  async function run(parts, onProgress = () => {}) {
    cancelled = false;
    if (actx.state !== 'running') await actx.resume().catch(() => {});
    const total = parts.reduce((a, p) => a + Math.max(0, p.end - p.start), 0) || 1;
    await load(parts[0].url);
    const W = video.videoWidth || 1080;
    const H = video.videoHeight || 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const stream = new MediaStream([...canvas.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = pickMime();
    const opts = { videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 };
    if (mime) opts.mimeType = mime;
    const rec = new MediaRecorder(stream, opts);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    const canPause = typeof rec.pause === 'function';
    let done = 0;
    let started = false;

    try {
      for (const part of parts) {
        if (cancelled) break;
        await load(part.url);
        await seek(part.start);
        g.drawImage(video, 0, 0, W, H);
        if (!started) { rec.start(1000); started = true; } else if (canPause && rec.state === 'paused') rec.resume();
        await video.play();
        await new Promise((resolve) => {
          const step = () => {
            g.drawImage(video, 0, 0, W, H);
            const t = video.currentTime;
            onProgress(Math.min(1, (done + Math.max(0, t - part.start)) / total));
            if (cancelled || video.ended || video.paused || t >= part.end) { resolve(); return; }
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        video.pause();
        // Mientras se carga la parte siguiente no se graba (si no, queda una imagen congelada).
        if (canPause && rec.state === 'recording') rec.pause();
        done += Math.max(0, part.end - part.start);
      }
    } finally {
      video.pause();
    }
    const blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: (rec.mimeType || mime || 'video/mp4').split(';')[0] }));
      if (rec.state === 'inactive') rec.onstop(); else rec.stop();
    });
    stream.getTracks().forEach((t) => t.stop());
    if (cancelled) return null;
    onProgress(1);
    return blob;
  }

  return {
    run,
    cancel() { cancelled = true; },
    dispose() {
      cancelled = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      actx.close().catch(() => {});
    },
  };
}

# Guion · Teleprompter

Teleprompter web (PWA) que sigue tu voz y graba video con la cámara frontal.

- **Voz**: el texto avanza a medida que hablás (Web Speech API).
- **Auto / Manual**: desplazamiento a velocidad fija o con el dedo.
- Grabación 1080p (MediaRecorder), cuenta regresiva, zonas seguras de Reels/TikTok/Shorts, guía de cara.
- Biblioteca de guiones con nichos, calendario (N videos por día) o lista, y búsqueda.
- Importar cualquier archivo: Excel (.xlsx y .xls viejo), Numbers, OpenDocument, CSV, PDF, Word (.docx), Pages (si trae vista previa), RTF, HTML y texto. Los documentos se dividen solos en guiones (por "Guion 1 / Video 2", códigos A001, días "Lunes 19/10" o "Día 3", etiquetas "Tema: / Guion:", separadores o párrafos) y se acomodan en el calendario o en lista.
- Lectores incluidos en `js/vendor/`: pdf.js (Apache 2.0) y SheetJS (Apache 2.0). Se cargan solo al importar ese tipo de archivo; todo se procesa en el dispositivo.

Sin build: son archivos estáticos. Para probar en local: `python3 -m http.server` y abrir `http://localhost:8000`.

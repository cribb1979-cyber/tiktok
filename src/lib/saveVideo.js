// Hämtar en renderad video (via vår egen /api/download-video-proxy, för att undvika CORS mot
// Shotstack/Runways S3-lagring) som en File, redo att delas.
export async function fetchVideoAsFile(videoUrl, filename = 'klipp.mp4') {
  const proxyUrl = `/api/download-video?url=${encodeURIComponent(videoUrl)}`

  const response = await fetch(proxyUrl)
  if (!response.ok) {
    throw new Error('Kunde inte hämta videon.')
  }

  const blob = await response.blob()
  return new File([blob], filename, { type: blob.type || 'video/mp4' })
}

// VIKTIGT: måste anropas direkt/synkront inifrån en click-handler, utan något await innan
// (inklusive ingen fetch) — annars tappar iOS Safari kopplingen till användarens knapptryck
// och nekar navigator.share() med "NotAllowedError: The request is not allowed...". Filen
// måste alltså redan vara hämtad (se fetchVideoAsFile) innan den här anropas.
export function shareVideoFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file] })
  }

  // Fallback (webbläsare utan Web Share API för filer): vanlig nedladdningslänk, hamnar i
  // Filer-appen snarare än Bilder på iOS.
  const blobUrl = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = file.name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  return Promise.resolve('downloaded')
}

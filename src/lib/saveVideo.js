// Hämtar en renderad video (via vår egen /api/download-video-proxy, för att undvika CORS mot
// Shotstack/Runways S3-lagring) och sparar den till enheten. Föredrar Web Share API
// (navigator.share med files) — det öppnar iOS/Androids riktiga delningsmeny med "Spara
// video"/"Spara till Bilder" direkt, mer pålitligt än att förlita sig på att användaren
// själv hittar rätt i webbläsarens inbyggda videospelare. Faller tillbaka på en vanlig
// nedladdningslänk (hamnar i Filer-appen) om delning inte stöds.
export async function saveVideoToDevice(videoUrl, filename = 'klipp.mp4') {
  const proxyUrl = `/api/download-video?url=${encodeURIComponent(videoUrl)}`

  const response = await fetch(proxyUrl)
  if (!response.ok) {
    throw new Error('Kunde inte hämta videon för att spara den.')
  }

  const blob = await response.blob()
  const file = new File([blob], filename, { type: blob.type || 'video/mp4' })

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file] })
    return 'shared'
  }

  const blobUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000)
  return 'downloaded'
}

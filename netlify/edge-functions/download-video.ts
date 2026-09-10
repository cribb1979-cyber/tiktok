// Proxar en video-URL (Shotstack/Runway) genom vår egen domän så klienten kan fetch:a den
// utan att krocka med CORS — den externa S3-lagringen skickar inte nödvändigtvis
// Access-Control-Allow-Origin-headers som tillåter fetch från vår domän direkt.
// Ingen API-nyckel involverad, bara en ren passthrough.

export default async (request: Request) => {
  const videoUrl = new URL(request.url).searchParams.get('url')
  if (!videoUrl) {
    return new Response('Query-parametern url krävs.', { status: 400 })
  }

  let upstream: Response
  try {
    upstream = await fetch(videoUrl)
  } catch (err) {
    return new Response(`Kunde inte hämta videon: ${String(err)}`, { status: 502 })
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(`Kunde inte hämta videon (HTTP ${upstream.status}).`, { status: 502 })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'video/mp4',
      'Content-Disposition': 'attachment; filename="klipp.mp4"',
      'Cache-Control': 'no-store',
    },
  })
}

export const config = {
  path: '/api/download-video',
}

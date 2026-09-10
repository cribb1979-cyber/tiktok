import { useEffect, useState } from 'react'
import { tiktokAdapter } from '../lib/tiktokAdapter.js'

export default function Installningar() {
  const [status, setStatus] = useState({ connected: false, accountName: null })
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    setStatus(tiktokAdapter.getConnectionStatus())
  }, [])

  async function handleConnect() {
    setConnecting(true)
    setError(null)
    try {
      const connection = await tiktokAdapter.connectAccount()
      setStatus({ connected: true, accountName: connection.accountName })
    } catch (err) {
      setError(err.message)
    } finally {
      setConnecting(false)
    }
  }

  async function handleDisconnect() {
    setError(null)
    try {
      await tiktokAdapter.disconnectAccount()
      setStatus({ connected: false, accountName: null })
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h1>Inställningar</h1>
      </header>

      {error && <p className="error-banner">{error}</p>}

      <div className="clip-form">
        <h2 style={{ margin: 0 }}>TikTok-koppling</h2>

        {tiktokAdapter.isMock && (
          <p className="placeholder-note">
            Mock-läge. Riktig TikTok-koppling (OAuth, Content Posting API, Display API) kräver
            ett godkänt TikTok Developer-konto och appgranskning. Publicering och resultat är
            simulerade tills dess — adaptern är byggd så det går att koppla på skarpt utan att
            ändra resten av appen.
          </p>
        )}

        {status.connected ? (
          <>
            <p>
              Ansluten som <strong>{status.accountName}</strong>
            </p>
            <button className="btn-danger" onClick={handleDisconnect}>
              Koppla från
            </button>
          </>
        ) : (
          <button className="btn-primary" onClick={handleConnect} disabled={connecting}>
            {connecting ? 'Ansluter…' : 'Anslut TikTok (mock)'}
          </button>
        )}
      </div>

      <div className="clip-form">
        <h2 style={{ margin: 0 }}>API-nycklar</h2>
        <p className="placeholder-note">
          Claude-, Whisper- och Shotstack-nycklarna hanteras som miljövariabler i Netlify
          (Site settings → Environment variables) och visas aldrig här i klienten.
        </p>
      </div>
    </div>
  )
}

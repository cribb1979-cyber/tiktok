import { useEffect, useRef } from 'react'

// Håller skärmen tänd så länge `active` är true (t.ex. under en pågående generering/
// rendering) — annars slocknar skärmen av vanlig inaktivitet, vilket på iOS kan pausa/döda
// sidans JS-exekvering (samma bakomliggande WebKit-beteende som filuppladdningsbuggen, se
// useFileInputFallback.js) och avbryta en klientstyrd pollningsloop mitt i.
//
// Löser INTE fallet där man byter till en helt annan app eller låser telefonen manuellt med
// strömknappen — ingen webbstandard kan hindra det, bara automatisk skärmsläckning av
// inaktivitet. Stöds av Safari/iOS 16.4+ och moderna Chrome/Android — på äldre webbläsare
// (`'wakeLock' in navigator` är false) är detta ett tyst no-op, ingen krasch.
export function useWakeLock(active) {
  const wakeLockRef = useRef(null)

  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return

    let cancelled = false

    async function requestLock() {
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          lock.release().catch(() => {})
          return
        }
        wakeLockRef.current = lock
      } catch {
        // Kan nekas (t.ex. om fliken råkar vara dold exakt då) — no-op, försöks igen vid
        // nästa visibilitychange nedan.
      }
    }

    requestLock()

    // Webbläsaren släpper automatiskt låset så fort fliken göms (även en kort appväxling) —
    // begärs på nytt när man kommer tillbaka, så länge `active` fortfarande är true.
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        requestLock()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [active])
}

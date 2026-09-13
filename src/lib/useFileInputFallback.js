import { useEffect, useRef } from 'react'

// iOS Safari-bugg (bekräftad skarpt): input[type=file]'s "change"-event avfyras ibland ALDRIG
// efter att ha valt en bild/video från FOTOBIBLIOTEKET (till skillnad från "Ta foto"/"Filma",
// som fungerar felfritt) — appen ser ut att "inte göra något" när man kommer tillbaka från
// bildväljaren. Troligen tappar WKWebView JS-exekveringen medan det inbyggda, systemägda
// bildväljargränssnittet är öppet (kan ta ett tag om iCloud-foton behöver laddas ner), och
// "change"-eventet som borde skickas när man återvänder hinner aldrig avfyras innan sidan
// fryser/pausas — ett känt, återkommande WebKit-mönster, inte specifikt för den här appen.
//
// Input-elementets EGEN `.files`-lista verkar dock oftast vara korrekt satt av iOS ändå, bara
// att JS-eventet som skulle meddela oss om det aldrig kommer. Den här kroken är ett
// skyddsnät: när fliken blir synlig/får fokus igen (dvs. man är tillbaka i appen efter att
// bildväljaren stängts, oavsett OM den stängdes via ett fungerande "change"-event eller inte)
// kollas `input.files` manuellt. En enkel nyckel (namn+storlek+ändringsdatum) håller reda på
// senast hanterad fil så samma fil aldrig behandlas två gånger — t.ex. om "change" FAKTISKT
// avfyrades normalt (kameraflödet) hade annars både det vanliga anropet OCH skyddsnätet kört.
//
// Använding: byt `onChange={(e) => handler(e.target.files?.[0])}` mot
// `onChange={useFileInputFallback(inputRef, handler)}` och sätt `ref={inputRef}` på samma
// <input>.
export function useFileInputFallback(inputRef, onFile) {
  const lastKeyRef = useRef(null)
  // onFile kan vara en ny funktion varje render (vanligt för inline-handlers) — sparas i en
  // ref så att den mount-en-gång-effekten nedan alltid anropar den SENASTE versionen istället
  // för att fastna med en inaktuell closure.
  const onFileRef = useRef(onFile)
  onFileRef.current = onFile

  function process(file) {
    if (!file) return
    const key = `${file.name}-${file.size}-${file.lastModified}`
    if (key === lastKeyRef.current) return
    lastKeyRef.current = key
    onFileRef.current(file)
    // Nollställer input-värdet (samma som appen redan gjorde manuellt för huvuduppladdningen)
    // så samma fil kan väljas igen om man vill lägga till den en gång till, och så nästa
    // "change"/skyddsnäts-kontroll startar från ett tomt läge. lastKeyRef nollställs samtidigt
    // — annars skulle EXAKT samma fil (namn/storlek/ändringsdatum) tolkas som "redan hanterad"
    // om man medvetet väljer den på nytt.
    if (inputRef.current) inputRef.current.value = ''
    lastKeyRef.current = null
  }

  useEffect(() => {
    function checkNow() {
      process(inputRef.current?.files?.[0])
    }
    function handleVisible() {
      if (document.visibilityState === 'visible') {
        // Liten fördröjning — iOS hinner inte alltid uppdatera input.files exakt i samma
        // tick som fliken blir synlig igen.
        setTimeout(checkNow, 300)
      }
    }
    document.addEventListener('visibilitychange', handleVisible)
    window.addEventListener('focus', handleVisible)
    return () => {
      document.removeEventListener('visibilitychange', handleVisible)
      window.removeEventListener('focus', handleVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (e) => process(e.target.files?.[0])
}

import { Link } from 'react-router-dom'

export default function Tips() {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Tips &amp; trix</h1>
      </header>

      <p className="placeholder-note">
        En snabbguide när du filmar själv (istället för Manus/AI-avatar eller AI-kortfilm) —
        vilka effekter som finns, hur du lägger till dem i Klippstudio, i vilken ordning de
        läggs ovanpå varandra, och hur klippning/redigering fungerar.
      </p>

      <div className="clip-card">
        <p className="clip-category">1. Innan du filmar</p>
        <p className="clip-prompt">
          Filma stående (9:16, samma format som klippet blir) — liggande video beskärs annars
          hårt. Korta klipp går snabbare att ladda upp och transkribera (Whisper har en
          25 MB-gräns, se nedan). Prata tydligt och med pauser mellan meningar — det ger
          renare undertexter och gör det lättare för Claude att hitta bra klippställen.
        </p>
      </div>

      <div className="clip-card">
        <p className="clip-category">2. Ladda upp och skriv din idé</p>
        <p className="clip-prompt">
          "Lägg till klipp" i Klippstudio, gärna flera korta klipp om du filmat i omgångar —
          de klipps ihop automatiskt i den ordning Claude tycker passar berättelsen. Skriv
          sedan din prompt + kategori/underämne och tryck "Föreslå klippningsplan". Filer över
          25 MB laddas upp men hoppar över transkribering (klippningsplanen baseras då bara på
          din prompt istället för vad som faktiskt sägs).
        </p>
      </div>

      <div className="clip-card">
        <p className="clip-category">3. Vilka effekter finns (under "Avancerat")</p>
        <p className="clip-prompt">
          <strong>B-roll</strong> — ett kort, atmosfäriskt AI-genererat inklipp (natur, rök,
          ljus — aldrig personer som standard) som klipps in direkt efter ditt första segment,
          som en klassisk "cutaway". Vill du bara ha en fristående B-roll-video att spara,
          utan uppladdning eller klippningsplan: <Link to="/broll">öppna B-roll-verktyget</Link>.
        </p>
        <p className="clip-prompt">
          <strong>AI-effekt</strong> — ett ljuseffekt-lager ovanpå videon under första
          segmentet: ljusklot, dimma, gnistor, kantglöd, TV-brus, eller lysande ögon.
        </p>
        <p className="clip-prompt">
          <strong>Bakgrundsbyte</strong> — byter ut bakgrunden bakom dig i första segmentet mot
          en AI-genererad bild (kräver att din video har en enkel, stilla bakgrund för att
          nyckling ska fungera bra).
        </p>
        <p className="clip-prompt">
          <strong>Tankebubblor</strong> — korta, glödande "inre tankar" som poppar upp ovanpå
          bilden, en per segment, på en plats du själv drar dit i canvasen.
        </p>
        <p className="clip-prompt">
          <strong>Glow</strong> — en manuellt positionerad, pulserande glödeffekt över ett
          valt tidsintervall — bra för att få t.ex. en tatuering eller ett föremål att se ut
          att glöda. Ingen AI-spårning, så motivet behöver hålla sig still i bild.
        </p>
      </div>

      <div className="clip-card">
        <p className="clip-category">4. Hur du lägger till dem</p>
        <p className="clip-prompt">
          Alla ligger dolda bakom knappen "Avancerat" under klippningsplanen i Klippstudio —
          öppna den, kryssa i det du vill använda, skriv en egen idé (eller låt Claude förfina
          en utifrån din hook/kategori) och tryck generera. Du ser resultatet direkt i
          canvasen ("Klippets sammansättning") tillsammans med allt annat du redan lagt till,
          så du kan flytta t.ex. glow/tankebubbla innan du renderar skarpt.
        </p>
      </div>

      <div className="clip-card">
        <p className="clip-category">5. Ordning som spelar roll</p>
        <p className="clip-prompt">
          Lagren läggs ovanpå varandra i en fast ordning, uppifrån och ner: hook-texten
          (bara de första ~2,5 sekunderna) → tankebubblor → undertexter → glow → AI-effekt →
          din video → bakgrundsbilden längst bak. Praktiskt: en tankebubbla täcker
          undertexter om de hamnar på samma plats, och en stor glow kan hamna bakom
          undertexterna om du placerar den nära botten av bilden. Dra isär dem i canvasen om
          något börjar skymma något annat.
        </p>
      </div>

      <div className="clip-card">
        <p className="clip-category">6. Klippning/redigering</p>
        <p className="clip-prompt">
          Varje segments start-/sluttid och hastighet (t.ex. slow-motion för en viktig mening)
          går att justera manuellt i segmentlistan — det skriver över Claudes förslag utan att
          du behöver generera om hela planen. Övergångar mellan segment (fade/wipe/slide)
          väljs och varieras automatiskt, inget att ställa in själv. Vill du ändra HELA
          upplägget med en fri instruktion istället för att pilla i varje segment för sig:
          använd "Redigera med vägledning" — skriv t.ex. "korta ner mittendelen" eller "gör
          klippet mer punchy" så tolkar Claude om planen åt dig.
        </p>
      </div>
    </div>
  )
}

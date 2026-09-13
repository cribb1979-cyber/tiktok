import { Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar.jsx'
import Idebank from './pages/Idebank.jsx'
import Klippstudio from './pages/Klippstudio.jsx'
import Bibliotek from './pages/Bibliotek.jsx'
import Kalender from './pages/Kalender.jsx'
import Installningar from './pages/Installningar.jsx'
import Tips from './pages/Tips.jsx'
import Broll from './pages/Broll.jsx'
import { supabaseConfigured } from './lib/supabaseClient.js'

export default function App() {
  return (
    <div className="app">
      <main className="app-content">
        {!supabaseConfigured && (
          <p className="error-banner">
            Supabase är inte konfigurerat i den här miljön (VITE_SUPABASE_URL /
            VITE_SUPABASE_ANON_KEY saknas). Lägg till dem i Netlifys Environment variables och
            deploya om.
          </p>
        )}
        <Routes>
          <Route path="/" element={<Idebank />} />
          <Route path="/studio" element={<Klippstudio />} />
          <Route path="/bibliotek" element={<Bibliotek />} />
          <Route path="/kalender" element={<Kalender />} />
          <Route path="/installningar" element={<Installningar />} />
          <Route path="/tips" element={<Tips />} />
          <Route path="/broll" element={<Broll />} />
        </Routes>
      </main>
      <NavBar />
    </div>
  )
}

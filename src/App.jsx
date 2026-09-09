import { Routes, Route } from 'react-router-dom'
import NavBar from './components/NavBar.jsx'
import Idebank from './pages/Idebank.jsx'
import Klippstudio from './pages/Klippstudio.jsx'
import Bibliotek from './pages/Bibliotek.jsx'
import Kalender from './pages/Kalender.jsx'
import Installningar from './pages/Installningar.jsx'

export default function App() {
  return (
    <div className="app">
      <main className="app-content">
        <Routes>
          <Route path="/" element={<Idebank />} />
          <Route path="/studio" element={<Klippstudio />} />
          <Route path="/bibliotek" element={<Bibliotek />} />
          <Route path="/kalender" element={<Kalender />} />
          <Route path="/installningar" element={<Installningar />} />
        </Routes>
      </main>
      <NavBar />
    </div>
  )
}

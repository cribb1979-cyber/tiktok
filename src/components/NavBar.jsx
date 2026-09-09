import { NavLink } from 'react-router-dom'

const TABS = [
  { to: '/', label: 'Idébank', icon: '💡' },
  { to: '/studio', label: 'Studio', icon: '🎬' },
  { to: '/bibliotek', label: 'Bibliotek', icon: '📚' },
  { to: '/kalender', label: 'Kalender', icon: '📅' },
  { to: '/installningar', label: 'Inst.', icon: '⚙️' },
]

export default function NavBar() {
  return (
    <nav className="navbar">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) => 'navbar-tab' + (isActive ? ' active' : '')}
        >
          <span className="navbar-icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="navbar-label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

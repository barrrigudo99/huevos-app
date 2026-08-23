import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { ROLES } from '../data/users'
import { loginUser, registerUser } from '../api'

export default function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', role: 'jugador' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }))
    setError('')
  }

  function switchMode(next) {
    setMode(next)
    setForm({ name: '', email: '', password: '', confirm: '', role: 'jugador' })
    setError('')
  }

  async function handleLogin(e) {
    e.preventDefault()
    const email = form.email.trim().toLowerCase()
    if (!email || !form.password) {
      setError('Introduce email y contraseña.')
      return
    }
    setLoading(true)
    try {
      const user = await loginUser({ email, password: form.password })
      onLogin(user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    const name = form.name.trim()
    const email = form.email.trim().toLowerCase()
    if (!name || !email || !form.password) {
      setError('Rellena todos los campos.')
      return
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setError('El email no es válido.')
      return
    }
    if (form.password.length < 6) {
      setError('La contraseña debe tener al menos 6 caracteres.')
      return
    }
    if (form.password !== form.confirm) {
      setError('Las contraseñas no coinciden.')
      return
    }
    setLoading(true)
    try {
      const user = await registerUser({ name, email, password: form.password, role: form.role })
      onLogin(user)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-brand">
        <ShieldCheck size={32} color="var(--accent)" />
        <p className="auth-title">Futbol 7 Manager</p>
        <p className="auth-subtitle">Gestiona tu equipo, seas jugador o entrenador</p>
      </div>

      <div className="auth-tabs">
        <button
          type="button"
          className={`auth-tab ${mode === 'login' ? 'active' : ''}`}
          onClick={() => switchMode('login')}
        >
          Iniciar sesión
        </button>
        <button
          type="button"
          className={`auth-tab ${mode === 'register' ? 'active' : ''}`}
          onClick={() => switchMode('register')}
        >
          Registrarse
        </button>
      </div>

      {mode === 'login' ? (
        <form className="card form" onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => updateField('email', e.target.value)}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={form.password}
            onChange={(e) => updateField('password', e.target.value)}
          />
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      ) : (
        <form className="card form" onSubmit={handleRegister}>
          <input
            placeholder="Nombre"
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => updateField('email', e.target.value)}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={form.password}
            onChange={(e) => updateField('password', e.target.value)}
          />
          <input
            type="password"
            placeholder="Confirmar contraseña"
            value={form.confirm}
            onChange={(e) => updateField('confirm', e.target.value)}
          />
          <p className="hint" style={{ margin: '0' }}>
            Regístrate como
          </p>
          <div className="pos-pills">
            {ROLES.map((role) => (
              <button
                type="button"
                key={role.code}
                className={`pos-pill ${form.role === role.code ? 'selected' : ''}`}
                onClick={() => updateField('role', role.code)}
              >
                {role.label}
              </button>
            ))}
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? 'Creando...' : 'Crear cuenta'}
          </button>
        </form>
      )}
    </div>
  )
}

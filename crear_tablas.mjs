// crear_tablas.mjs
// Crea (o actualiza) el esquema de la base de datos SQLite para futbol7-app,
// según el diagrama que acordamos: equipos, partidos, convocatorias, votos,
// eventos_partido, jugadores, jugador_posiciones (+ posiciones y club).
//
// Uso (desde la raíz del proyecto, donde ya hiciste npm install better-sqlite3):
//   node crear_tablas.mjs
//
// Es seguro ejecutarlo varias veces: usa CREATE TABLE IF NOT EXISTS, así que
// no borra nada si las tablas ya existen.

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, 'server', 'futbol7.db')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
CREATE TABLE IF NOT EXISTS club (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nombre TEXT
);

CREATE TABLE IF NOT EXISTS equipos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS posiciones (
  code TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jugadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  number INTEGER,
  phone TEXT UNIQUE,
  birth_date TEXT,
  photo TEXT
);

CREATE TABLE IF NOT EXISTS jugador_posiciones (
  jugador_id INTEGER NOT NULL REFERENCES jugadores(id) ON DELETE CASCADE,
  posicion_code TEXT NOT NULL REFERENCES posiciones(code),
  PRIMARY KEY (jugador_id, posicion_code)
);

CREATE TABLE IF NOT EXISTS partidos (
  id INTEGER PRIMARY KEY,
  jornada INTEGER NOT NULL,
  fecha TEXT NOT NULL,
  equipo_local_id INTEGER NOT NULL REFERENCES equipos(id),
  equipo_visitante_id INTEGER NOT NULL REFERENCES equipos(id),
  goles_local INTEGER,
  goles_visitante INTEGER,
  jugado INTEGER NOT NULL DEFAULT 0,
  whatsapp_poll_id TEXT
);

CREATE TABLE IF NOT EXISTS convocatorias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partido_id INTEGER NOT NULL UNIQUE REFERENCES partidos(id) ON DELETE CASCADE,
  archived_at TEXT
);

CREATE TABLE IF NOT EXISTS votos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  convocatoria_id INTEGER NOT NULL REFERENCES convocatorias(id) ON DELETE CASCADE,
  jugador_id INTEGER NOT NULL REFERENCES jugadores(id),
  voto TEXT NOT NULL CHECK (voto IN ('Si', 'No')),
  UNIQUE (convocatoria_id, jugador_id)
);

CREATE TABLE IF NOT EXISTS eventos_partido (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  partido_id INTEGER NOT NULL REFERENCES partidos(id) ON DELETE CASCADE,
  jugador_id INTEGER NOT NULL REFERENCES jugadores(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('gol', 'asistencia', 'tarjeta_amarilla', 'tarjeta_roja')),
  minuto INTEGER
);

CREATE INDEX IF NOT EXISTS idx_partidos_local ON partidos(equipo_local_id);
CREATE INDEX IF NOT EXISTS idx_partidos_visitante ON partidos(equipo_visitante_id);
CREATE INDEX IF NOT EXISTS idx_votos_jugador ON votos(jugador_id);
CREATE INDEX IF NOT EXISTS idx_votos_convocatoria ON votos(convocatoria_id);
CREATE INDEX IF NOT EXISTS idx_eventos_partido ON eventos_partido(partido_id);
CREATE INDEX IF NOT EXISTS idx_eventos_jugador ON eventos_partido(jugador_id);
`)

const insertarPosicion = db.prepare(
  'INSERT OR IGNORE INTO posiciones (code, label) VALUES (?, ?)'
)
const posicionesBase = [
  ['POR', 'Portero'],
  ['LAT', 'Lateral'],
  ['CEN', 'Central'],
  ['VOL', 'Volante'],
  ['DEL', 'Delantero'],
]
const insertarPosiciones = db.transaction((filas) => {
  filas.forEach(([code, label]) => insertarPosicion.run(code, label))
})
insertarPosiciones(posicionesBase)

console.log(`Base de datos creada/actualizada en ${DB_PATH}`)
console.log('Tablas:', db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name).join(', '))

db.close()
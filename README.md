# Futbol 7 Manager

App móvil (web) para gestionar un equipo de fútbol 7: plantilla, alineación, sucesos en vivo del partido y estadísticas. Construida con React + Vite, sin dependencias pesadas.

## Cómo arrancarla

Necesitas tener [Node.js](https://nodejs.org) instalado (versión 18 o superior).

```
npm install
npm run dev:full
```

Esto levanta a la vez el servidor de datos (API en `http://localhost:4000`) y la web (`http://localhost:5173`). Para probarla como se vería en el móvil, abre esa URL desde el navegador de tu teléfono conectado a la misma red, o usa el modo de emulación móvil del navegador de escritorio.

Si prefieres arrancarlos por separado (dos terminales): `npm run server` y `npm run dev`.

`npm run build` genera la versión de producción en `dist/` (sigue necesitando `npm run server` corriendo aparte, porque `vite preview` también usa el proxy `/api`).

## Estructura

```
server/
  index.js                API Express: jugadores, registro y login
  db.json                 base de datos en JSON (se lee/escribe en cada cambio)
src/
  App.jsx                 login/sesión + orquesta las 4 pantallas y el estado global
  api.js                   funciones fetch contra la API (/api/...)
  data/players.js          posiciones y etiquetas
  data/users.js             roles (jugador/entrenador) y etiquetas
  components/
    LoginScreen.jsx        login y registro (jugador/entrenador)
    BottomNav.jsx          barra de navegación inferior
    PlantillaScreen.jsx    lista de jugadores + alta de jugador
    AlineacionScreen.jsx   campo con selección de once titular
    PartidoScreen.jsx      marcador, minuto y registro de sucesos
    StatsScreen.jsx        goles, tarjetas y máximos goleadores
  styles.css               variables de color y estilos, mobile-first
```

Los jugadores y los usuarios registrados se guardan en `server/db.json`, un fichero JSON real en disco que lee y escribe el servidor Express (`server/index.js`) en cada alta. La sesión activa (quién ha iniciado sesión en ese dispositivo) se sigue guardando en `localStorage` del navegador.

Nota: las contraseñas se guardan en texto plano en `db.json` porque es una solución local de momento, sin cifrado ni hashing — no subas ese fichero con datos reales a un repositorio público.

## Próximo paso: llevarla a Android/iPhone

Cuando quieras publicarla en las tiendas sin reescribir nada, se envuelve con [Capacitor](https://capacitorjs.com/):

```
npm install @capacitor/core @capacitor/cli
npx cap init
npm run build
npx cap add android
npx cap add ios
```

Esto genera proyectos nativos de Android/iOS que cargan esta misma app.

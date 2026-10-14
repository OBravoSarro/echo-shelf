# EchoShelf

Aplicacion PWA offline-first para descubrir, organizar y escuchar audiolibros desde Google Drive.

## Stack

- React 18 + TypeScript strict + Vite
- React Router + Tailwind CSS + Framer Motion
- Zustand para estado global
- Dexie/IndexedDB y adaptador OPFS para almacenamiento local
- Google Drive API v3 + Firebase Authentication (Google provider)
- vite-plugin-pwa + Workbox
- Vitest + React Testing Library + Playwright

## Scripts

- `npm run dev` inicia desarrollo
- `npm run lint` ejecuta oxlint
- `npm run test` ejecuta pruebas unitarias
- `npm run test:e2e` ejecuta e2e
- `npm run build` compila para produccion

## Variables de entorno

Copia `.env.example` a `.env`.

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_GOOGLE_DRIVE_ROOT_ID`: carpeta raiz inicial para escaneo Drive
- `VITE_GOOGLE_BOOKS_API_KEY`: opcional para enriquecer metadatos con Google Books
- `VITE_ENABLE_GOOGLE_BOOKS`: `true` para activar Google Books en enriquecimiento online

## Configurar Firebase + Drive

1. Crea proyecto en Firebase Console (Spark/free).
2. Activa Authentication > Sign-in method > Google.
3. Agrega dominios autorizados (`localhost`, dominio Vercel).
4. En Google Cloud del mismo proyecto, activa **Google Drive API**.
5. Configura OAuth Consent Screen en modo Testing.
6. Agrega tus cuentas como Test users.
7. Copia configuracion web de Firebase y rellena `.env`.

El flujo implementado usa Firebase `signInWithPopup` y solicita scope `drive.readonly`.

## Flujo de uso

1. Arranca la app con `npm run dev`.
2. En Ajustes, conecta Google.
3. En Biblioteca, define `Drive root folder ID` y lanza escaneo.
4. Desde Biblioteca descarga un libro.
5. Reproduce desde el reproductor inmersivo.

## Arquitectura

- `src/features/*`: auth, library, player, downloads, settings
- `src/infrastructure/google-drive/*`: API Drive y scanner
- `src/infrastructure/firebase/*`: autenticacion Firebase/Google
- `src/infrastructure/persistence/*`: Dexie + OPFS fallback
- `src/infrastructure/audio/*`: motor de reproduccion desacoplado de React

## Offline y PWA

- App shell cacheada por service worker
- Manifest standalone + metadatos iOS
- Catalogo, progreso y descargas en almacenamiento local
- Descargas interrumpidas quedan en estado recuperable

## Limitaciones iOS documentadas

- iOS puede suspender PWAs en segundo plano y pausar descargas.
- No se garantiza continuidad de descarga con app suspendida.
- Persistencia de almacenamiento depende de politicas del sistema.

## Despliegue en Firebase

1. Instala CLI: `npm i -g firebase-tools`
2. Login: `firebase login`
3. Vincula proyecto: `firebase use --add`
4. Build: `npm run build`
5. Deploy hosting + firestore rules: `firebase deploy`

El repo incluye `firebase.json`, `firestore.rules` y `firestore.indexes.json` para SPA + reglas por usuario autenticado.

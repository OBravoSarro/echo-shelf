import { CheckCircle2, Cloud, FolderSearch, RefreshCw, ShieldCheck, Unplug, XCircle } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { UserAvatar } from '../../components/ui/user-avatar'
import type { DriveFile } from '../../infrastructure/google-drive/types'
import { driveApi } from '../../infrastructure/google-drive/drive-api'
import { compareSemver, CURRENT_APP_VERSION, fetchLatestVersion } from '../../lib/app-version'
import { env, hasFirebaseAuthConfig } from '../../lib/env'
import { useAuthStore } from '../auth/auth-store'
import { useLibraryStore } from '../library/library-store'

const sectionVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: 'easeOut' as const } },
}

export const SettingsPage = () => {
  const reduceMotion = useReducedMotion()
  const auth = useAuthStore()
  const library = useLibraryStore()
  const [manualRootId, setManualRootId] = useState(library.driveRootId ?? env.driveRootId ?? '')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerFolders, setPickerFolders] = useState<DriveFile[]>([])
  const [pickerPath, setPickerPath] = useState<Array<{ id: string; name: string }>>([])
  const [pickerCurrentId, setPickerCurrentId] = useState('root')
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerError, setPickerError] = useState<string | undefined>()
  const [latestVersion, setLatestVersion] = useState<string | undefined>()
  const [versionCheckError, setVersionCheckError] = useState<string | undefined>()
  const [checkingVersion, setCheckingVersion] = useState(false)
  const showReconnect = auth.reconnectRequired && Boolean(auth.displayName || auth.email || auth.photoUrl || auth.userId)

  const syncStatusTone: Record<NonNullable<typeof library.cloudSyncStatus>, string> = {
    idle: 'border-white/20 bg-white/8 text-slate-300',
    syncing: 'border-cyan-300/30 bg-cyan-300/10 text-cyan-100',
    online: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100',
    offline: 'border-amber-300/30 bg-amber-300/10 text-amber-100',
    error: 'border-rose-300/30 bg-rose-300/10 text-rose-100',
  }

  const syncStatusLabel: Record<NonNullable<typeof library.cloudSyncStatus>, string> = {
    idle: 'Sync inactiva',
    syncing: 'Sincronizando',
    online: 'Sync activa',
    offline: 'Sin conexion',
    error: 'Error de sync',
  }

  const loadFolders = async (parentId: string, path: Array<{ id: string; name: string }>) => {
    if (!auth.accessToken) return
    setPickerLoading(true)
    setPickerError(undefined)
    try {
      const folders = await driveApi.listFolders(auth.accessToken, parentId)
      setPickerCurrentId(parentId)
      setPickerPath(path)
      setPickerFolders(folders)
    } catch (error) {
      setPickerError(error instanceof Error ? error.message : 'No se pudieron cargar carpetas')
    } finally {
      setPickerLoading(false)
    }
  }

  const openPicker = async () => {
    setPickerOpen(true)
    await loadFolders('root', [])
  }

  const checkVersion = async () => {
    setCheckingVersion(true)
    setVersionCheckError(undefined)
    try {
      const result = await fetchLatestVersion()
      setLatestVersion(result.latestVersion)
    } catch {
      setVersionCheckError('No se pudo verificar la ultima version en este momento.')
    } finally {
      setCheckingVersion(false)
    }
  }

  useEffect(() => {
    void checkVersion()
  }, [])

  const selectRoot = async (id: string) => {
    setManualRootId(id)
    await library.setDriveRootId(id)
    setPickerOpen(false)
  }

  return (
    <motion.section
      className="space-y-6"
      variants={reduceMotion ? undefined : { hidden: {}, visible: { transition: { staggerChildren: 0.1, delayChildren: 0.05 } } }}
      initial="hidden"
      animate="visible"
    >
      <motion.header variants={reduceMotion ? undefined : sectionVariants}>
        <h1 className="text-2xl font-semibold">Ajustes</h1>
        <p className="text-sm text-slate-400">Control de cuenta Google, origen de biblioteca y privacidad local.</p>
      </motion.header>

      <motion.article variants={reduceMotion ? undefined : sectionVariants} className="rounded-2xl border border-white/10 bg-white/6 p-4">
        <h2 className="mb-3 text-lg font-medium">Google Drive</h2>
        {hasFirebaseAuthConfig ? (
          <>
            {auth.connected ? (
              <div className="mb-4 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                <UserAvatar
                  photoUrl={auth.photoUrl}
                  name={auth.displayName}
                  email={auth.email}
                  sizeClassName="size-10"
                  textClassName="text-sm font-semibold"
                  fallbackClassName="bg-white/15"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{auth.displayName ?? 'Cuenta de Google'}</p>
                  <p className="truncate text-xs text-slate-400">{auth.email ?? 'Sesion activa'}</p>
                </div>
              </div>
            ) : showReconnect ? (
              <p className="mb-4 text-sm text-amber-100">Sesion expirada. Usa reconectar para recuperar acceso sin perder tu biblioteca.</p>
            ) : (
              <p className="mb-4 text-sm text-slate-300">Conecta tu cuenta de Google para sincronizar la biblioteca.</p>
            )}
            <div className="flex flex-wrap gap-3">
              {!auth.connected ? (
                <button
                  type="button"
                  onClick={() => {
                    void (showReconnect ? auth.reconnect() : auth.signIn())
                  }}
                  className="rounded-xl bg-gradient-to-r from-accent-violet to-accent-magenta px-4 py-2 text-sm font-medium"
                >
                  {showReconnect ? 'Reconectar Google' : 'Conectar con Google'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => auth.signOut()}
                  className="inline-flex items-center gap-2 rounded-xl border border-rose-300/30 bg-rose-300/10 px-4 py-2 text-sm text-rose-100"
                >
                  <Unplug className="size-4" /> Desconectar cuenta
                </button>
              )}
              {auth.error && <span className="text-sm text-rose-300">{auth.error}</span>}
            </div>

            {auth.connected && (
              <div className="mt-4 rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${syncStatusTone[library.cloudSyncStatus]}`}>
                      <Cloud className="size-3.5" /> {syncStatusLabel[library.cloudSyncStatus]}
                    </span>
                    {library.cloudLastSyncedAt && (
                      <span className="text-xs text-slate-400">Ultima sync: {library.cloudLastSyncedAt.replace('T', ' ').slice(0, 19)}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void library.forceCloudSync(auth.userId)
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs"
                  >
                    <RefreshCw className="size-3.5" /> Forzar sync estado
                  </button>
                </div>
                {library.cloudSyncMessage && <p className="mt-2 text-xs text-slate-300">{library.cloudSyncMessage}</p>}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">
            Falta configuracion de autenticacion. Revisa las variables de entorno para habilitar Google Drive.
          </div>
        )}
      </motion.article>

      <motion.article variants={reduceMotion ? undefined : sectionVariants} className="rounded-2xl border border-white/10 bg-white/6 p-4">
        <h2 className="mb-3 text-lg font-medium">Origen de biblioteca</h2>
        {auth.connected && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={manualRootId}
                onChange={(event) => setManualRootId(event.target.value)}
                className="min-w-[260px] flex-1 rounded-xl border border-white/15 bg-bg-900/80 px-3 py-2 text-sm outline-none"
                placeholder="Google Drive root folder ID"
              />
              <button
                type="button"
                onClick={() => {
                  void openPicker()
                }}
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm"
              >
                <FolderSearch className="size-4" /> Elegir carpeta
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = manualRootId.trim()
                  if (!id) return
                  await library.setDriveRootId(id)
                }}
                className="rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm"
              >
                Guardar carpeta
              </button>
              <button
                type="button"
                onClick={async () => {
                  const id = manualRootId.trim() || library.driveRootId
                  if (!auth.accessToken || !id) return
                  await library.setDriveRootId(id)
                  await library.syncDrive(auth.accessToken, id)
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent-violet to-accent-magenta px-4 py-2 text-sm font-medium"
              >
                <RefreshCw className="size-4" /> Sincronizar ahora
              </button>
            </div>
            <p className="text-xs text-slate-400">Carpeta guardada: {library.driveRootId ?? 'sin configurar'}</p>
          </div>
        )}
      </motion.article>

      <motion.article variants={reduceMotion ? undefined : sectionVariants} className="rounded-2xl border border-white/10 bg-white/6 p-4 text-sm text-slate-300">
        <h2 className="mb-2 inline-flex items-center gap-2 text-lg font-medium text-white"><ShieldCheck className="size-5" /> Privacidad</h2>
        <ul className="space-y-2">
          <li>- Tokens guardados en IndexedDB y revocados al desconectar.</li>
          <li>- No se suben audiolibros a servidores propios.</li>
          <li>- Descargas locales se conservan hasta que las elimines manualmente.</li>
        </ul>
      </motion.article>

      <motion.article variants={reduceMotion ? undefined : sectionVariants} className="rounded-2xl border border-white/10 bg-white/6 p-4 text-sm text-slate-200">
        <h2 className="mb-3 text-lg font-medium text-white">Version de la app</h2>
        <div className="space-y-2">
          <p>Version actual: <span className="font-semibold text-white">v{CURRENT_APP_VERSION}</span></p>
          {latestVersion ? (
            <div className="flex flex-wrap items-center gap-2">
              <p>Ultima disponible: <span className="font-semibold text-white">v{latestVersion}</span></p>
              {compareSemver(CURRENT_APP_VERSION, latestVersion) >= 0 ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2.5 py-1 text-xs text-emerald-100">
                  <CheckCircle2 className="size-3.5" /> Estas en la ultima version
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-100">
                  <XCircle className="size-3.5" /> Hay una version mas nueva
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-slate-400">Ultima disponible: no verificada</p>
          )}
          {versionCheckError && <p className="text-xs text-amber-200">{versionCheckError}</p>}
          <button
            type="button"
            onClick={() => {
              void checkVersion()
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs"
            disabled={checkingVersion}
          >
            <RefreshCw className={`size-3.5 ${checkingVersion ? 'animate-spin' : ''}`} />
            {checkingVersion ? 'Verificando...' : 'Verificar version'}
          </button>
        </div>
      </motion.article>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-bg-900 p-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold">Elegir carpeta de Drive</h3>
              <button type="button" onClick={() => setPickerOpen(false)} className="rounded-lg border border-white/20 px-3 py-1 text-xs">
                Cerrar
              </button>
            </div>
            <p className="mb-3 truncate text-xs text-slate-400">
              Ruta: Mi unidad{pickerPath.map((item) => ` / ${item.name}`).join('')}
            </p>
            <div className="mb-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  void selectRoot(pickerCurrentId)
                }}
                className="rounded-lg bg-gradient-to-r from-accent-violet to-accent-magenta px-3 py-2 text-xs font-medium"
              >
                Usar esta carpeta
              </button>
              <button
                type="button"
                onClick={() => {
                  if (pickerPath.length === 0) {
                    return
                  }
                  const parentPath = pickerPath.slice(0, -1)
                  const parentId = parentPath[parentPath.length - 1]?.id ?? 'root'
                  void loadFolders(parentId, parentPath)
                }}
                className="rounded-lg border border-white/20 px-3 py-2 text-xs"
              >
                Subir nivel
              </button>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {pickerLoading && <p className="text-sm text-slate-400">Cargando carpetas...</p>}
              {pickerError && <p className="text-sm text-rose-300">{pickerError}</p>}
              {!pickerLoading && !pickerError && pickerFolders.length === 0 && (
                <p className="text-sm text-slate-400">No hay subcarpetas en este nivel.</p>
              )}
              {pickerFolders.map((folder) => (
                <div key={folder.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      void loadFolders(folder.id, [...pickerPath, { id: folder.id, name: folder.name }])
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                  >
                    <FolderSearch className="size-4 shrink-0" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void selectRoot(folder.id)
                    }}
                    className="rounded-lg border border-white/20 px-3 py-1 text-xs"
                  >
                    Elegir
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.section>
  )
}

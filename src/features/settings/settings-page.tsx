import { CheckCircle2, ChevronRight, Cloud, FolderSearch, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, Unplug, XCircle } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import { type ReactNode, useEffect, useState } from 'react'
import { Reveal } from '../../components/motion/reveal'
import { LargeTitle } from '../../components/ui/large-title'
import { Sheet } from '../../components/ui/sheet'
import { UserAvatar } from '../../components/ui/user-avatar'
import type { DriveFile } from '../../infrastructure/google-drive/types'
import { driveApi } from '../../infrastructure/google-drive/drive-api'
import { compareSemver, CURRENT_APP_VERSION, fetchLatestVersion } from '../../lib/app-version'
import { env, hasFirebaseAuthConfig } from '../../lib/env'
import { useAuthStore } from '../auth/auth-store'
import { useLibraryStore } from '../library/library-store'

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
    <section className="space-y-10 pb-4">
      <LargeTitle eyebrow="Preferencias" title="Ajustes" subtitle="Control de cuenta Google, origen de biblioteca y privacidad local." />

      <Reveal>
        <SettingsGroup icon={<Cloud className="size-4" />} iconClassName="from-sky-400 to-blue-600" title="Google Drive">
          {hasFirebaseAuthConfig ? (
            <>
              <div className="grouped-row">
                {auth.connected ? (
                  <>
                    <UserAvatar
                      photoUrl={auth.photoUrl}
                      name={auth.displayName}
                      email={auth.email}
                      sizeClassName="size-12"
                      textClassName="text-sm font-semibold"
                      fallbackClassName="bg-white/15"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-medium text-white">{auth.displayName ?? 'Cuenta de Google'}</p>
                      <p className="truncate text-xs text-white/45">{auth.email ?? 'Sesion activa'}</p>
                    </div>
                  </>
                ) : showReconnect ? (
                  <p className="text-sm text-amber-100">Sesion expirada. Usa reconectar para recuperar acceso sin perder tu biblioteca.</p>
                ) : (
                  <p className="text-sm text-white/65">Conecta tu cuenta de Google para sincronizar la biblioteca.</p>
                )}
              </div>

              {auth.connected && (
                <div className="grouped-row flex-wrap justify-between">
                  <div className="inline-flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${syncStatusTone[library.cloudSyncStatus]}`}>
                      <span className={`size-1.5 rounded-full bg-current ${library.cloudSyncStatus === 'syncing' ? 'animate-pulse' : ''}`} />
                      {syncStatusLabel[library.cloudSyncStatus]}
                    </span>
                    {library.cloudLastSyncedAt && (
                      <span className="text-xs tabular-nums text-white/40">Ultima sync: {library.cloudLastSyncedAt.replace('T', ' ').slice(0, 19)}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      void library.forceCloudSync(auth.userId)
                    }}
                    className="btn-secondary px-3 py-1.5 text-xs"
                  >
                    <RefreshCw className={`size-3.5 ${library.cloudSyncStatus === 'syncing' ? 'animate-spin' : ''}`} /> Forzar sync estado
                  </button>
                </div>
              )}
              {auth.connected && library.cloudSyncMessage && (
                <div className="grouped-row">
                  <p className="text-xs text-white/55">{library.cloudSyncMessage}</p>
                </div>
              )}

              <div className="grouped-row flex-wrap">
                {!auth.connected ? (
                  <button
                    type="button"
                    onClick={() => {
                      void (showReconnect ? auth.reconnect() : auth.signIn())
                    }}
                    className="btn-accent"
                  >
                    {showReconnect ? 'Reconectar Google' : 'Conectar con Google'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => auth.signOut()}
                    className="btn-pill border border-rose-300/25 bg-rose-400/10 text-rose-200 hover:bg-rose-400/20"
                  >
                    <Unplug className="size-4" /> Desconectar cuenta
                  </button>
                )}
                {auth.error && <span className="text-sm text-rose-300">{auth.error}</span>}
              </div>
            </>
          ) : (
            <div className="grouped-row">
              <p className="text-sm text-amber-100">Falta configuracion de autenticacion. Revisa las variables de entorno para habilitar Google Drive.</p>
            </div>
          )}
        </SettingsGroup>
      </Reveal>

      <Reveal>
        <SettingsGroup icon={<FolderSearch className="size-4" />} iconClassName="from-violet-400 to-fuchsia-600" title="Origen de biblioteca">
          {auth.connected ? (
            <>
              <div className="grouped-row flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <input
                  value={manualRootId}
                  onChange={(event) => setManualRootId(event.target.value)}
                  className="field min-w-0 flex-1"
                  placeholder="Google Drive root folder ID"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void openPicker()
                    }}
                    className="btn-secondary"
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
                    className="btn-secondary"
                  >
                    Guardar carpeta
                  </button>
                </div>
              </div>
              <div className="grouped-row flex-wrap justify-between">
                <p className="min-w-0 truncate text-xs text-white/45">Carpeta guardada: {library.driveRootId ?? 'sin configurar'}</p>
                <button
                  type="button"
                  onClick={async () => {
                    const id = manualRootId.trim() || library.driveRootId
                    if (!auth.accessToken || !id) return
                    await library.setDriveRootId(id)
                    await library.syncDrive(auth.accessToken, id)
                  }}
                  className="btn-accent"
                >
                  <RefreshCw className={`size-4 ${library.loading ? 'animate-spin' : ''}`} /> Sincronizar ahora
                </button>
              </div>
            </>
          ) : (
            <div className="grouped-row">
              <p className="text-sm text-white/45">Conecta tu cuenta para elegir la carpeta de audiolibros.</p>
            </div>
          )}
        </SettingsGroup>
      </Reveal>

      <Reveal>
        <SettingsGroup icon={<ShieldCheck className="size-4" />} iconClassName="from-emerald-400 to-teal-600" title="Privacidad">
          {[
            'Access token de Drive temporal en cliente y refresh token cifrado en cookie HttpOnly del backend.',
            'No se suben audiolibros a servidores propios.',
            'Descargas locales se conservan hasta que las elimines manualmente.',
          ].map((item) => (
            <div key={item} className="grouped-row">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-300/80" />
              <p className="text-sm text-white/70">{item}</p>
            </div>
          ))}
        </SettingsGroup>
      </Reveal>

      <Reveal>
        <SettingsGroup icon={<Sparkles className="size-4" />} iconClassName="from-amber-300 to-orange-500" title="Version de la app">
          <div className="grouped-row justify-between">
            <span className="text-sm text-white/70">Version actual</span>
            <span className="text-sm font-semibold tabular-nums text-white">v{CURRENT_APP_VERSION}</span>
          </div>
          <div className="grouped-row flex-wrap justify-between">
            <span className="text-sm text-white/70">Ultima disponible</span>
            {latestVersion ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-white">v{latestVersion}</span>
                {compareSemver(CURRENT_APP_VERSION, latestVersion) >= 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2.5 py-1 text-xs text-emerald-100">
                    <CheckCircle2 className="size-3.5" /> Estas en la ultima version
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-xs text-amber-100">
                    <XCircle className="size-3.5" /> Hay una version mas nueva
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-white/40">no verificada</span>
            )}
          </div>
          {versionCheckError && (
            <div className="grouped-row">
              <p className="text-xs text-amber-200">{versionCheckError}</p>
            </div>
          )}
          <div className="grouped-row">
            <button
              type="button"
              onClick={() => {
                void checkVersion()
              }}
              className="btn-secondary px-3 py-1.5 text-xs"
              disabled={checkingVersion}
            >
              <RefreshCw className={`size-3.5 ${checkingVersion ? 'animate-spin' : ''}`} />
              {checkingVersion ? 'Verificando...' : 'Verificar version'}
            </button>
          </div>
        </SettingsGroup>
      </Reveal>

      <Sheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Elegir carpeta de Drive"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
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
              disabled={pickerPath.length === 0}
              className="btn-secondary disabled:opacity-40"
            >
              Subir nivel
            </button>
            <button
              type="button"
              onClick={() => {
                void selectRoot(pickerCurrentId)
              }}
              className="btn-primary"
            >
              Usar esta carpeta
            </button>
          </div>
        }
      >
        <p className="mb-3 truncate text-xs text-white/45">
          Ruta: Mi unidad{pickerPath.map((item) => ` / ${item.name}`).join('')}
        </p>
        <div className="grouped">
          {pickerLoading && (
            <div className="grouped-row text-sm text-white/45">
              <LoaderCircle className="size-4 animate-spin" /> Cargando carpetas...
            </div>
          )}
          {pickerError && <div className="grouped-row text-sm text-rose-300">{pickerError}</div>}
          {!pickerLoading && !pickerError && pickerFolders.length === 0 && (
            <div className="grouped-row text-sm text-white/45">No hay subcarpetas en este nivel.</div>
          )}
          {!pickerLoading &&
            pickerFolders.map((folder, index) => (
              <motion.div
                key={folder.id}
                initial={reduceMotion ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(index, 10) * 0.03, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                className="grouped-row justify-between hover:bg-white/[0.04]"
              >
                <button
                  type="button"
                  onClick={() => {
                    void loadFolders(folder.id, [...pickerPath, { id: folder.id, name: folder.name }])
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left text-sm"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-400/15 text-sky-300">
                    <FolderSearch className="size-4" />
                  </span>
                  <span className="truncate">{folder.name}</span>
                  <ChevronRight className="ml-auto size-4 shrink-0 text-white/25" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void selectRoot(folder.id)
                  }}
                  className="btn-secondary ml-2 px-3 py-1 text-xs"
                >
                  Elegir
                </button>
              </motion.div>
            ))}
        </div>
      </Sheet>
    </section>
  )
}

const SettingsGroup = ({
  icon,
  iconClassName,
  title,
  children,
}: {
  icon: ReactNode
  iconClassName: string
  title: string
  children: ReactNode
}) => (
  <article className="space-y-2.5">
    <h2 className="flex items-center gap-2.5 px-1 text-[15px] font-semibold tracking-tight text-white">
      <span className={`grid size-7 place-items-center rounded-lg bg-gradient-to-br text-white shadow-[0_6px_16px_-6px_rgba(0,0,0,0.6)] ${iconClassName}`}>
        {icon}
      </span>
      {title}
    </h2>
    <div className="grouped">{children}</div>
  </article>
)

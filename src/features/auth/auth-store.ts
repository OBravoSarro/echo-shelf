import { create } from 'zustand'
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { db } from '../../infrastructure/persistence/db'
import { firebaseAuth, googleAuthProvider } from '../../infrastructure/firebase/client'
import { env, hasFirebaseAuthConfig } from '../../lib/env'

type DriveRefreshResponse = {
  accessToken: string
  expiresIn: number
}

type DriveStartResponse = {
  authorizationUrl: string
}

type AuthStatus = 'anonymous' | 'restoring' | 'connected' | 'refreshing' | 'reconnect_required' | 'error'

class AuthFlowError extends Error {
  readonly code: string
  readonly reconnectRequired: boolean
  readonly retryable: boolean

  constructor(message: string, options?: { code?: string; reconnectRequired?: boolean; retryable?: boolean }) {
    super(message)
    this.name = 'AuthFlowError'
    this.code = options?.code ?? 'unknown'
    this.reconnectRequired = options?.reconnectRequired ?? false
    this.retryable = options?.retryable ?? false
  }
}

let refreshTimeout: ReturnType<typeof setTimeout> | undefined
let refreshRetryTimeout: ReturnType<typeof setTimeout> | undefined
let refreshRetryAttempt = 0

const MAX_REFRESH_RETRIES = 3
const REFRESH_RETRY_DELAYS_MS = [1_000, 3_000, 8_000]

const clearRefreshRetryTimeout = () => {
  if (refreshRetryTimeout) {
    clearTimeout(refreshRetryTimeout)
    refreshRetryTimeout = undefined
  }
  refreshRetryAttempt = 0
}

const clearRefreshTimeout = () => {
  if (refreshTimeout) {
    clearTimeout(refreshTimeout)
    refreshTimeout = undefined
  }
}

const scheduleRefresh = (expiresAt: number | undefined, refresh: () => Promise<void>) => {
  clearRefreshTimeout()
  if (!expiresAt) return
  const msUntilRefresh = Math.max(0, expiresAt - Date.now() - 60_000)
  refreshTimeout = setTimeout(() => {
    void refresh()
  }, msUntilRefresh)
}

const scheduleRefreshRetry = (refresh: () => Promise<void>) => {
  if (refreshRetryAttempt >= MAX_REFRESH_RETRIES) return
  const delay = REFRESH_RETRY_DELAYS_MS[refreshRetryAttempt] ?? REFRESH_RETRY_DELAYS_MS[REFRESH_RETRY_DELAYS_MS.length - 1]
  refreshRetryAttempt += 1
  refreshRetryTimeout = setTimeout(() => {
    void refresh()
  }, delay)
}

const isOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine)

const shouldRetryRefresh = (error: unknown): boolean => {
  if (!isOnline()) return true
  if (error instanceof AuthFlowError) return error.retryable
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return message.includes('network') || message.includes('timeout') || message.includes('fetch') || message.includes('temporar')
}

const buildApiUrl = (path: string): string => {
  const base = env.authApiBaseUrl?.trim()
  if (!base) return path
  if (base.endsWith('/')) return `${base.slice(0, -1)}${path}`
  return `${base}${path}`
}

const parseError = async (response: Response): Promise<{ code?: string; message?: string }> => {
  try {
    const json = (await response.json()) as { code?: string; message?: string }
    return { code: json.code, message: json.message }
  } catch {
    return { message: undefined }
  }
}

const waitForFirebaseAuthReady = async (): Promise<void> => {
  const auth = firebaseAuth
  if (!auth) return
  await new Promise<void>((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      unsubscribe()
      resolve()
    })
  })
}

const requestDriveRefresh = async (firebaseIdToken: string): Promise<DriveRefreshResponse> => {
  const response = await fetch(buildApiUrl('/api/oauth/google/refresh'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${firebaseIdToken}`,
    },
  })

  if (response.ok) {
    return (await response.json()) as DriveRefreshResponse
  }

  const { code, message } = await parseError(response)
  if (response.status === 401) {
    throw new AuthFlowError(message ?? 'La sesion de Firebase caduco. Inicia sesion de nuevo.', {
      code: code ?? 'unauthorized',
      reconnectRequired: true,
      retryable: false,
    })
  }

  if (response.status === 404 || response.status === 409 || code === 'link_required') {
    throw new AuthFlowError(message ?? 'Necesitas reconectar Google Drive una vez para guardar el refresh token.', {
      code: code ?? 'link_required',
      reconnectRequired: true,
      retryable: false,
    })
  }

  if (response.status >= 500 || response.status === 429) {
    throw new AuthFlowError(message ?? 'Error temporal al renovar sesion con backend.', {
      code: code ?? 'server_error',
      reconnectRequired: false,
      retryable: true,
    })
  }

  throw new AuthFlowError(message ?? 'No se pudo renovar sesion de Drive.', {
    code: code ?? 'refresh_failed',
    reconnectRequired: false,
    retryable: false,
  })
}

const startDriveLink = async (firebaseIdToken: string) => {
  const response = await fetch(buildApiUrl('/api/oauth/google/start'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${firebaseIdToken}`,
    },
    body: JSON.stringify({ returnTo: '/settings' }),
  })

  if (!response.ok) {
    const { message } = await parseError(response)
    throw new AuthFlowError(message ?? 'No se pudo iniciar la vinculacion con Google Drive.', {
      code: 'oauth_start_failed',
      reconnectRequired: true,
      retryable: false,
    })
  }

  const json = (await response.json()) as DriveStartResponse
  if (!json.authorizationUrl) {
    throw new AuthFlowError('Respuesta invalida iniciando OAuth de Drive.', {
      code: 'oauth_start_invalid_response',
      reconnectRequired: true,
      retryable: false,
    })
  }

  if (typeof window !== 'undefined') {
    window.location.assign(json.authorizationUrl)
  }
}

const resolveExpiresAt = (expiresInSeconds: number): number => {
  const normalized = Number.isFinite(expiresInSeconds) ? expiresInSeconds : 3600
  return Date.now() + Math.max(0, normalized - 60) * 1000
}

interface AuthState {
  userId?: string
  accessToken?: string
  expiresAt?: number
  displayName?: string
  email?: string
  photoUrl?: string
  connected: boolean
  status: AuthStatus
  reconnectRequired: boolean
  loading: boolean
  error?: string
  bootstrap: () => Promise<void>
  signIn: () => Promise<void>
  refresh: () => Promise<void>
  reconnect: () => Promise<void>
  signOut: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  connected: false,
  status: 'anonymous',
  reconnectRequired: false,
  loading: false,
  async bootstrap() {
    if (!hasFirebaseAuthConfig) {
      set({ status: 'anonymous', connected: false, reconnectRequired: false, loading: false })
      return
    }

    set({ status: 'restoring', loading: true, error: undefined })
    await waitForFirebaseAuthReady()

    const user = firebaseAuth?.currentUser
    if (!user) {
      await db.auth.delete('google')
      clearRefreshTimeout()
      clearRefreshRetryTimeout()
      set({
        status: 'anonymous',
        connected: false,
        reconnectRequired: false,
        loading: false,
        accessToken: undefined,
        expiresAt: undefined,
        userId: undefined,
        displayName: undefined,
        email: undefined,
        photoUrl: undefined,
      })
      return
    }

    const cached = await db.auth.get('google')
    const displayName = user.displayName ?? cached?.displayName ?? undefined
    const email = user.email ?? cached?.connectedEmail ?? undefined
    const photoUrl = user.photoURL ?? cached?.photoUrl ?? undefined
    const userId = user.uid

    if (cached?.accessToken && cached.expiresAt && cached.expiresAt > Date.now() + 60_000) {
      set({
        status: 'connected',
        connected: true,
        reconnectRequired: false,
        loading: false,
        userId,
        accessToken: cached.accessToken,
        expiresAt: cached.expiresAt,
        displayName,
        email,
        photoUrl,
      })
      clearRefreshRetryTimeout()
      scheduleRefresh(cached.expiresAt, get().refresh)
      return
    }

    try {
      const idToken = await user.getIdToken()
      const token = await requestDriveRefresh(idToken)
      const expiresAt = resolveExpiresAt(token.expiresIn)
      await db.auth.put({
        id: 'google',
        userId,
        accessToken: token.accessToken,
        expiresAt,
        connectedEmail: email,
        displayName,
        photoUrl,
        updatedAt: new Date().toISOString(),
      })
      set({
        status: 'connected',
        connected: true,
        reconnectRequired: false,
        loading: false,
        userId,
        accessToken: token.accessToken,
        expiresAt,
        displayName,
        email,
        photoUrl,
        error: undefined,
      })
      clearRefreshRetryTimeout()
      scheduleRefresh(expiresAt, get().refresh)
    } catch (error) {
      const reconnectRequired = error instanceof AuthFlowError ? error.reconnectRequired : true
      await db.auth.put({
        id: 'google',
        userId,
        connectedEmail: email,
        displayName,
        photoUrl,
        updatedAt: new Date().toISOString(),
      })
      clearRefreshTimeout()
      clearRefreshRetryTimeout()
      set({
        status: reconnectRequired ? 'reconnect_required' : 'error',
        connected: false,
        reconnectRequired,
        loading: false,
        userId,
        accessToken: undefined,
        expiresAt: undefined,
        displayName,
        email,
        photoUrl,
        error: error instanceof Error ? error.message : 'No se pudo restaurar la sesion de Drive.',
      })
    }
  },

  async signIn() {
    if (!hasFirebaseAuthConfig) {
      set({ error: 'Configura Firebase para habilitar login de Google Drive.' })
      return
    }

    if (!firebaseAuth || !googleAuthProvider) {
      set({ error: 'Firebase auth no esta inicializado.' })
      return
    }

    set({ loading: true, status: 'refreshing', error: undefined })
    try {
      const result = await signInWithPopup(firebaseAuth, googleAuthProvider)
      const user = result.user
      const idToken = await user.getIdToken()

      try {
        const token = await requestDriveRefresh(idToken)
        const expiresAt = resolveExpiresAt(token.expiresIn)
        const displayName = user.displayName ?? undefined
        const email = user.email ?? undefined
        const photoUrl = user.photoURL ?? undefined
        const userId = user.uid

        await db.auth.put({
          id: 'google',
          userId,
          accessToken: token.accessToken,
          expiresAt,
          connectedEmail: email,
          displayName,
          photoUrl,
          updatedAt: new Date().toISOString(),
        })

        set({
          status: 'connected',
          connected: true,
          reconnectRequired: false,
          userId,
          accessToken: token.accessToken,
          expiresAt,
          displayName,
          email,
          photoUrl,
          loading: false,
          error: undefined,
        })
        clearRefreshRetryTimeout()
        scheduleRefresh(expiresAt, get().refresh)
        return
      } catch (error) {
        if (error instanceof AuthFlowError && error.reconnectRequired) {
          await db.auth.put({
            id: 'google',
            userId: user.uid,
            connectedEmail: user.email ?? undefined,
            displayName: user.displayName ?? undefined,
            photoUrl: user.photoURL ?? undefined,
            updatedAt: new Date().toISOString(),
          })
          set({
            status: 'reconnect_required',
            connected: false,
            reconnectRequired: true,
            loading: false,
            userId: user.uid,
            displayName: user.displayName ?? undefined,
            email: user.email ?? undefined,
            photoUrl: user.photoURL ?? undefined,
            error: 'Termina la vinculacion de Drive para mantener sesion persistente.',
          })
          await startDriveLink(idToken)
          return
        }
        throw error
      }
    } catch (error) {
      const reconnectRequired = error instanceof AuthFlowError ? error.reconnectRequired : false
      set({
        status: reconnectRequired ? 'reconnect_required' : 'error',
        reconnectRequired,
        error: error instanceof Error ? error.message : 'Unable to sign in',
        loading: false,
      })
    }
  },

  async refresh() {
    const user = firebaseAuth?.currentUser
    if (!user) {
      clearRefreshTimeout()
      clearRefreshRetryTimeout()
      set({
        status: 'anonymous',
        connected: false,
        reconnectRequired: false,
        accessToken: undefined,
        expiresAt: undefined,
      })
      return
    }

    set({ status: 'refreshing', error: undefined })
    try {
      const idToken = await user.getIdToken()
      const token = await requestDriveRefresh(idToken)
      const expiresAt = resolveExpiresAt(token.expiresIn)
      const currentAuth = await db.auth.get('google')

      await db.auth.put({
        id: 'google',
        userId: user.uid,
        accessToken: token.accessToken,
        expiresAt,
        connectedEmail: user.email ?? currentAuth?.connectedEmail,
        displayName: user.displayName ?? currentAuth?.displayName,
        photoUrl: user.photoURL ?? currentAuth?.photoUrl,
        updatedAt: new Date().toISOString(),
      })

      set({
        status: 'connected',
        connected: true,
        reconnectRequired: false,
        userId: user.uid,
        accessToken: token.accessToken,
        expiresAt,
        displayName: user.displayName ?? currentAuth?.displayName,
        email: user.email ?? currentAuth?.connectedEmail,
        photoUrl: user.photoURL ?? currentAuth?.photoUrl,
        error: undefined,
      })
      clearRefreshRetryTimeout()
      scheduleRefresh(expiresAt, get().refresh)
    } catch (error) {
      const reconnectRequired = error instanceof AuthFlowError ? error.reconnectRequired : false
      if (!reconnectRequired && shouldRetryRefresh(error) && refreshRetryAttempt < MAX_REFRESH_RETRIES) {
        set({
          status: 'refreshing',
          connected: true,
          reconnectRequired: false,
          error: 'Reintentando renovar sesion automaticamente...',
        })
        scheduleRefreshRetry(get().refresh)
        return
      }

      const exhaustedRetries = refreshRetryAttempt >= MAX_REFRESH_RETRIES
      clearRefreshTimeout()
      clearRefreshRetryTimeout()
      set({
        status: reconnectRequired || exhaustedRetries ? 'reconnect_required' : 'error',
        connected: false,
        reconnectRequired: reconnectRequired || exhaustedRetries,
        accessToken: undefined,
        expiresAt: undefined,
        error: error instanceof Error ? error.message : 'Unable to refresh token',
      })
    }
  },

  async reconnect() {
    const user = firebaseAuth?.currentUser
    if (!user) {
      await get().signIn()
      return
    }

    set({ loading: true, status: 'refreshing', error: undefined })
    try {
      const idToken = await user.getIdToken()
      await startDriveLink(idToken)
      set({ loading: false })
    } catch (error) {
      set({
        loading: false,
        status: 'reconnect_required',
        reconnectRequired: true,
        error: error instanceof Error ? error.message : 'No se pudo reconectar Drive.',
      })
    }
  },

  async signOut() {
    if (hasFirebaseAuthConfig && firebaseAuth) {
      await signOut(firebaseAuth)
    }
    await db.auth.delete('google')
    clearRefreshTimeout()
    clearRefreshRetryTimeout()
    set({
      status: 'anonymous',
      accessToken: undefined,
      userId: undefined,
      expiresAt: undefined,
      displayName: undefined,
      email: undefined,
      photoUrl: undefined,
      connected: false,
      reconnectRequired: false,
      loading: false,
      error: undefined,
    })
  },
}))

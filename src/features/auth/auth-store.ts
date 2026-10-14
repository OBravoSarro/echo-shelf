import { create } from 'zustand'
import { GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth'
import { db } from '../../infrastructure/persistence/db'
import { driveAuthProvider, firebaseAuth } from '../../infrastructure/firebase/client'
import { env, hasFirebaseAuthConfig } from '../../lib/env'

type TokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
}

type TokenClient = {
  requestAccessToken: (options?: { prompt?: string }) => void
  callback?: (response: TokenResponse) => void
}

let gisLoader: Promise<void> | undefined
let tokenClient: TokenClient | undefined
let refreshTimeout: ReturnType<typeof setTimeout> | undefined
let refreshRetryTimeout: ReturnType<typeof setTimeout> | undefined
let refreshRetryAttempt = 0

const MAX_REFRESH_RETRIES = 3
const REFRESH_RETRY_DELAYS_MS = [1_000, 3_000, 8_000]

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

const isOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine)

const clearRefreshRetryTimeout = () => {
  if (refreshRetryTimeout) {
    clearTimeout(refreshRetryTimeout)
    refreshRetryTimeout = undefined
  }
  refreshRetryAttempt = 0
}

const shouldRetryRefresh = (error: unknown): boolean => {
  if (!isOnline()) return true
  if (error instanceof AuthFlowError) return error.retryable
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('failed to fetch') ||
    message.includes('temporar') ||
    message.includes('google identity')
  )
}

const mapTokenError = (errorCode?: string): AuthFlowError => {
  switch (errorCode) {
    case 'interaction_required':
    case 'consent_required':
    case 'immediate_failed':
    case 'login_required':
      return new AuthFlowError('Se requiere reconectar tu cuenta de Google.', {
        code: errorCode,
        reconnectRequired: true,
        retryable: false,
      })
    case 'access_denied':
    case 'popup_closed_by_user':
    case 'popup_failed_to_open':
      return new AuthFlowError('No se pudo completar la autenticacion con Google.', {
        code: errorCode,
        reconnectRequired: true,
        retryable: false,
      })
    default:
      return new AuthFlowError('No fue posible obtener access token', {
        code: errorCode,
        reconnectRequired: false,
        retryable: true,
      })
  }
}

const loadGoogleIdentity = (): Promise<void> => {
  if (gisLoader) return gisLoader
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Identity no disponible'))
  }
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve()
  }
  gisLoader = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('No fue posible cargar Google Identity'))
    document.head.appendChild(script)
  })
  return gisLoader
}

const ensureTokenClient = async (): Promise<TokenClient> => {
  if (!env.googleOauthClientId) {
    throw new Error('Falta VITE_GOOGLE_OAUTH_CLIENT_ID')
  }
  await loadGoogleIdentity()
  if (!window.google?.accounts?.oauth2) {
    throw new Error('Google Identity no esta disponible')
  }
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: env.googleOauthClientId,
      scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly',
      callback: () => {},
    })
  }
  return tokenClient
}

const requestAccessToken = async (prompt: '' | 'consent' | 'none'): Promise<TokenResponse> => {
  const client = await ensureTokenClient()
  return new Promise((resolve, reject) => {
    client.callback = (response) => {
      if (!response || response.error || !response.access_token) {
        reject(mapTokenError(response?.error))
        return
      }
      resolve(response)
    }
    client.requestAccessToken({ prompt })
  })
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

const hasIdentity = (value: {
  userId?: string
  displayName?: string
  connectedEmail?: string
  photoUrl?: string
}): boolean => {
  return Boolean(value.userId || value.displayName || value.connectedEmail || value.photoUrl)
}

const resolveExpiresAt = (token: TokenResponse, fallbackMinutes: number): number => {
  if (token.expires_in && token.expires_in > 0) {
    return Date.now() + Math.max(0, token.expires_in - 60) * 1000
  }
  return Date.now() + fallbackMinutes * 60 * 1000
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
    const auth = await db.auth.get('google')
    if (!auth?.accessToken || !auth.expiresAt) {
      set({ status: 'anonymous', loading: false, connected: false, reconnectRequired: false })
      return
    }
    let stillValid = auth.expiresAt > Date.now() + 60_000
    let displayName = auth.displayName
    let email = auth.connectedEmail
    let photoUrl = auth.photoUrl
    let userId = auth.userId

    if (stillValid && (!displayName || !email || !photoUrl || !userId) && firebaseAuth?.currentUser) {
      displayName = displayName ?? firebaseAuth.currentUser.displayName ?? undefined
      email = email ?? firebaseAuth.currentUser.email ?? undefined
      photoUrl = photoUrl ?? firebaseAuth.currentUser.photoURL ?? undefined
      userId = userId ?? firebaseAuth.currentUser.uid
      await db.auth.put({
        ...auth,
        userId,
        displayName,
        connectedEmail: email,
        photoUrl,
        updatedAt: new Date().toISOString(),
      })
    }

    if (!stillValid && env.googleOauthClientId) {
      try {
        const token = await requestAccessToken('none')
        const expiresAt = Date.now() + Math.max(0, (token.expires_in ?? 0) - 60) * 1000
        await db.auth.put({
          ...auth,
          accessToken: token.access_token!,
          expiresAt,
          updatedAt: new Date().toISOString(),
        })
        stillValid = true
        auth.accessToken = token.access_token!
        auth.expiresAt = expiresAt
      } catch {
        stillValid = false
      }
    }

    set({
      status: stillValid ? 'connected' : hasIdentity(auth) ? 'reconnect_required' : 'anonymous',
      connected: stillValid,
      reconnectRequired: !stillValid && hasIdentity(auth),
      userId,
      accessToken: stillValid ? auth.accessToken : undefined,
      expiresAt: stillValid ? auth.expiresAt : undefined,
      displayName,
      email,
      photoUrl,
      loading: false,
    })
    if (stillValid) {
      clearRefreshRetryTimeout()
      scheduleRefresh(auth.expiresAt, get().refresh)
    } else {
      clearRefreshTimeout()
      clearRefreshRetryTimeout()
    }
  },
  async signIn() {
    if (!hasFirebaseAuthConfig) {
      set({ error: 'Configura Firebase para habilitar login de Google Drive.' })
      return
    }
    set({ loading: true, status: 'refreshing', error: undefined })
    try {
      if (!firebaseAuth || !driveAuthProvider) {
        throw new Error('Firebase auth no esta inicializado')
      }
      const result = await signInWithPopup(firebaseAuth, driveAuthProvider)
      const credential = GoogleAuthProvider.credentialFromResult(result)
      const token = credential?.accessToken
      if (!token) {
        throw new Error('No fue posible obtener access token para Drive')
      }
      const displayName = result.user.displayName ?? undefined
      const email = result.user.email ?? undefined
      const photoUrl = result.user.photoURL ?? undefined
      const userId = result.user.uid
      const expiresAt = Date.now() + 55 * 60 * 1000
      const updatedAt = new Date().toISOString()
      await db.auth.put({
        id: 'google',
        userId,
        accessToken: token,
        expiresAt,
        connectedEmail: email,
        displayName,
        photoUrl,
        updatedAt,
      })
      set({
        status: 'connected',
        connected: true,
        reconnectRequired: false,
        userId,
        accessToken: token,
        expiresAt,
        displayName,
        email,
        photoUrl,
        loading: false,
        error: undefined,
      })
      clearRefreshRetryTimeout()
      scheduleRefresh(expiresAt, get().refresh)
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
    const current = get().accessToken
    if (!current) return
    set({ status: 'refreshing', error: undefined })
    if (!env.googleOauthClientId) {
      try {
        await get().signIn()
      } catch (error) {
        set({ error: error instanceof Error ? error.message : 'Unable to refresh token' })
      }
      return
    }
    try {
      const token = await requestAccessToken('none')
      const expiresAt = Date.now() + Math.max(0, (token.expires_in ?? 0) - 60) * 1000
      const currentAuth = await db.auth.get('google')
      if (currentAuth) {
        await db.auth.put({
          ...currentAuth,
          accessToken: token.access_token!,
          expiresAt,
          updatedAt: new Date().toISOString(),
        })
      }
      set({ status: 'connected', connected: true, reconnectRequired: false, accessToken: token.access_token, expiresAt, error: undefined })
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
    set({ loading: true, status: 'refreshing', error: undefined })
    try {
      if (env.googleOauthClientId) {
        const token = await requestAccessToken('consent')
        const expiresAt = resolveExpiresAt(token, 55)
        const currentAuth = await db.auth.get('google')
        const userId = firebaseAuth?.currentUser?.uid ?? currentAuth?.userId
        const displayName = firebaseAuth?.currentUser?.displayName ?? currentAuth?.displayName ?? undefined
        const email = firebaseAuth?.currentUser?.email ?? currentAuth?.connectedEmail ?? undefined
        const photoUrl = firebaseAuth?.currentUser?.photoURL ?? currentAuth?.photoUrl ?? undefined

        if (!userId) {
          await get().signIn()
          return
        }

        await db.auth.put({
          id: 'google',
          userId,
          accessToken: token.access_token!,
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
          accessToken: token.access_token,
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
      }

      await get().signIn()
    } catch {
      await get().signIn()
    }
  },
  async signOut() {
    if (hasFirebaseAuthConfig) {
      if (firebaseAuth) {
        await signOut(firebaseAuth)
      }
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

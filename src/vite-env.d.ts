/// <reference types="vite/client" />

declare module 'virtual:pwa-register' {
  export function registerSW(options?: {
    immediate?: boolean
    onNeedRefresh?: () => void
    onOfflineReady?: () => void
    onRegisteredSW?: (swUrl: string, registration?: ServiceWorkerRegistration) => void
  }): (reloadPage?: boolean) => Promise<void>
}

interface Window {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (options: {
          client_id: string
          scope: string
          callback: (response: { access_token?: string; expires_in?: number; error?: string }) => void
        }) => {
          requestAccessToken: (options?: { prompt?: string }) => void
          callback?: (response: { access_token?: string; expires_in?: number; error?: string }) => void
        }
      }
    }
  }
}

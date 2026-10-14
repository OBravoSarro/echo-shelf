import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore'
import { env, hasFirebaseAuthConfig } from '../../lib/env'

const firebaseApp = hasFirebaseAuthConfig
  ? initializeApp({
      apiKey: env.firebaseApiKey,
      authDomain: env.firebaseAuthDomain,
      projectId: env.firebaseProjectId,
      storageBucket: env.firebaseStorageBucket,
      messagingSenderId: env.firebaseMessagingSenderId,
      appId: env.firebaseAppId,
      measurementId: env.firebaseMeasurementId,
    })
  : undefined

export const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : undefined

const supportsIndexedDb =
  typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined'

export const firestoreDb = firebaseApp
  ? initializeFirestore(firebaseApp, {
      localCache: supportsIndexedDb
        ? persistentLocalCache({ tabManager: persistentMultipleTabManager() })
        : memoryLocalCache(),
    })
  : undefined

export const driveAuthProvider = hasFirebaseAuthConfig
  ? (() => {
      const provider = new GoogleAuthProvider()
      provider.addScope('openid')
      provider.addScope('email')
      provider.addScope('profile')
      provider.addScope('https://www.googleapis.com/auth/drive.readonly')
      provider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly')
      provider.setCustomParameters({ prompt: 'consent' })
      return provider
    })()
  : undefined

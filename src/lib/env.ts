import { z } from 'zod'

const envSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().optional(),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().optional(),
  VITE_FIREBASE_PROJECT_ID: z.string().optional(),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().optional(),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  VITE_FIREBASE_APP_ID: z.string().optional(),
  VITE_FIREBASE_MEASUREMENT_ID: z.string().optional(),
  VITE_GOOGLE_DRIVE_ROOT_ID: z.string().optional(),
  VITE_GOOGLE_BOOKS_API_KEY: z.string().optional(),
  VITE_ENABLE_GOOGLE_BOOKS: z.enum(['true', 'false']).optional(),
  VITE_GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
})

const parsed = envSchema.safeParse(import.meta.env)

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`)
}

export const env = {
  firebaseApiKey: parsed.data.VITE_FIREBASE_API_KEY,
  firebaseAuthDomain: parsed.data.VITE_FIREBASE_AUTH_DOMAIN,
  firebaseProjectId: parsed.data.VITE_FIREBASE_PROJECT_ID,
  firebaseStorageBucket: parsed.data.VITE_FIREBASE_STORAGE_BUCKET,
  firebaseMessagingSenderId: parsed.data.VITE_FIREBASE_MESSAGING_SENDER_ID,
  firebaseAppId: parsed.data.VITE_FIREBASE_APP_ID,
  firebaseMeasurementId: parsed.data.VITE_FIREBASE_MEASUREMENT_ID,
  driveRootId: parsed.data.VITE_GOOGLE_DRIVE_ROOT_ID,
  googleBooksApiKey: parsed.data.VITE_GOOGLE_BOOKS_API_KEY,
  enableGoogleBooks: parsed.data.VITE_ENABLE_GOOGLE_BOOKS === 'true',
  googleOauthClientId: parsed.data.VITE_GOOGLE_OAUTH_CLIENT_ID,
}

export const hasFirebaseAuthConfig = Boolean(
  env.firebaseApiKey && env.firebaseAuthDomain && env.firebaseProjectId && env.firebaseAppId,
)

import { randomUUID } from 'node:crypto'
import { encryptJson } from '../../_lib/crypto.js'
import { verifyFirebaseSession } from '../../_lib/firebase.js'
import { buildAuthorizationUrl } from '../../_lib/google-oauth.js'
import { json, methodNotAllowed } from '../../_lib/http.js'

const CALLBACK_STATE_TTL_SECONDS = 10 * 60

const sanitizeReturnTo = (value) => {
  if (typeof value !== 'string' || !value.startsWith('/')) {
    return '/settings'
  }
  return value
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, 'POST')
  }

  const session = await verifyFirebaseSession(req)
  if (!session.ok) {
    return json(res, session.status, { code: session.code, message: 'Sesion Firebase invalida.' })
  }

  try {
    const returnTo = sanitizeReturnTo(req.body?.returnTo)
    const state = encryptJson({
      nonce: randomUUID(),
      uid: session.uid,
      returnTo,
      exp: Date.now() + CALLBACK_STATE_TTL_SECONDS * 1000,
    })

    const authorizationUrl = buildAuthorizationUrl({ state })
    return json(res, 200, { authorizationUrl })
  } catch (error) {
    return json(res, 500, {
      code: 'oauth_start_failed',
      message: error instanceof Error ? error.message : 'No se pudo iniciar OAuth.',
    })
  }
}

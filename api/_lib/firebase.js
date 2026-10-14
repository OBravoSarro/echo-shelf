const FIREBASE_LOOKUP_ENDPOINT = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup'

const extractBearerToken = (header) => {
  if (!header) return undefined
  const [scheme, token] = header.split(' ')
  if (scheme !== 'Bearer' || !token) return undefined
  return token
}

export const verifyFirebaseSession = async (req) => {
  const apiKey = process.env.FIREBASE_WEB_API_KEY
  if (!apiKey) {
    throw new Error('Missing FIREBASE_WEB_API_KEY')
  }

  const token = extractBearerToken(req.headers.authorization)
  if (!token) {
    return { ok: false, code: 'missing_bearer_token', status: 401 }
  }

  const response = await fetch(`${FIREBASE_LOOKUP_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  })

  if (!response.ok) {
    return { ok: false, code: 'invalid_firebase_token', status: 401 }
  }

  const json = await response.json()
  const user = json?.users?.[0]
  if (!user?.localId) {
    return { ok: false, code: 'invalid_firebase_token', status: 401 }
  }

  return {
    ok: true,
    uid: user.localId,
    email: user.email,
    displayName: user.displayName,
    photoUrl: user.photoUrl,
  }
}

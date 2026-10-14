import { decryptJson, encryptJson } from '../../_lib/crypto.js'
import { exchangeAuthorizationCode } from '../../_lib/google-oauth.js'
import { clearCookie, setCookie } from '../../_lib/http.js'

const REFRESH_COOKIE_NAME = 'es_drive_rt'
const REFRESH_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 180

const getBaseUrl = (req) => {
  const configured = process.env.APP_BASE_URL?.trim()
  if (configured) {
    return configured.endsWith('/') ? configured.slice(0, -1) : configured
  }
  const host = req.headers['x-forwarded-host'] ?? req.headers.host
  const proto = req.headers['x-forwarded-proto'] ?? 'https'
  return `${proto}://${host}`
}

const redirect = (res, location) => {
  res.status(302).setHeader('Location', location).end()
}

const withStatus = (path, status, message) => {
  const url = new URL(path, 'https://placeholder.local')
  url.searchParams.set('oauth', status)
  if (message) url.searchParams.set('message', message)
  return `${url.pathname}${url.search}`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).end('Method not allowed')
    return
  }

  const baseUrl = getBaseUrl(req)
  const code = typeof req.query.code === 'string' ? req.query.code : undefined
  const stateToken = typeof req.query.state === 'string' ? req.query.state : undefined
  const oauthError = typeof req.query.error === 'string' ? req.query.error : undefined

  if (oauthError) {
    redirect(res, `${baseUrl}${withStatus('/settings', 'error', oauthError)}`)
    return
  }

  if (!code || !stateToken) {
    redirect(res, `${baseUrl}${withStatus('/settings', 'error', 'missing_code_or_state')}`)
    return
  }

  let state
  try {
    state = decryptJson(stateToken)
  } catch {
    redirect(res, `${baseUrl}${withStatus('/settings', 'error', 'invalid_state')}`)
    return
  }

  if (!state?.uid || !state?.exp || typeof state.uid !== 'string' || Date.now() > state.exp) {
    redirect(res, `${baseUrl}${withStatus('/settings', 'error', 'expired_state')}`)
    return
  }

  const tokenResponse = await exchangeAuthorizationCode(code)
  if (!tokenResponse.ok || !tokenResponse.refreshToken) {
    clearCookie(res, REFRESH_COOKIE_NAME)
    redirect(res, `${baseUrl}${withStatus('/settings', 'error', tokenResponse.error ?? 'missing_refresh_token')}`)
    return
  }

  const encryptedRefreshPayload = encryptJson({
    uid: state.uid,
    refreshToken: tokenResponse.refreshToken,
    createdAt: Date.now(),
  })

  setCookie(res, REFRESH_COOKIE_NAME, encryptedRefreshPayload, {
    path: '/',
    maxAge: REFRESH_COOKIE_TTL_SECONDS,
    sameSite: 'Lax',
    secure: true,
    httpOnly: true,
  })

  const returnPath = typeof state.returnTo === 'string' && state.returnTo.startsWith('/') ? state.returnTo : '/settings'
  redirect(res, `${baseUrl}${withStatus(returnPath, 'connected')}`)
}

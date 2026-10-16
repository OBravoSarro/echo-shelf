import { decryptJson } from '../../_lib/crypto.js'
import { verifyFirebaseSession } from '../../_lib/firebase.js'
import { refreshDriveAccessToken } from '../../_lib/google-oauth.js'
import { clearCookie, json, methodNotAllowed, parseCookies, shouldUseSecureCookies } from '../../_lib/http.js'

const REFRESH_COOKIE_NAME = 'es_drive_rt'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, 'POST')
  }

  const session = await verifyFirebaseSession(req)
  if (!session.ok) {
    return json(res, session.status, { code: session.code, message: 'Sesion Firebase invalida.' })
  }

  const useSecureCookies = shouldUseSecureCookies(req)

  const cookies = parseCookies(req)
  const encryptedRefreshPayload = cookies[REFRESH_COOKIE_NAME]
  if (!encryptedRefreshPayload) {
    return json(res, 404, {
      code: 'link_required',
      message: 'No hay refresh token asociado. Reconecta Google Drive.',
    })
  }

  let payload
  try {
    payload = decryptJson(encryptedRefreshPayload)
  } catch {
    clearCookie(res, REFRESH_COOKIE_NAME, {
      path: '/',
      sameSite: 'Lax',
      secure: useSecureCookies,
      httpOnly: true,
    })
    return json(res, 409, {
      code: 'link_required',
      message: 'Refresh token invalido. Reconecta Google Drive.',
    })
  }

  if (!payload?.uid || payload.uid !== session.uid || !payload.refreshToken) {
    clearCookie(res, REFRESH_COOKIE_NAME, {
      path: '/',
      sameSite: 'Lax',
      secure: useSecureCookies,
      httpOnly: true,
    })
    return json(res, 409, {
      code: 'link_required',
      message: 'Refresh token no coincide con la cuenta actual.',
    })
  }

  const refreshed = await refreshDriveAccessToken(payload.refreshToken)
  if (!refreshed.ok || !refreshed.accessToken) {
    if (refreshed.error === 'invalid_grant') {
      clearCookie(res, REFRESH_COOKIE_NAME, {
        path: '/',
        sameSite: 'Lax',
        secure: useSecureCookies,
        httpOnly: true,
      })
      return json(res, 409, {
        code: 'link_required',
        message: 'Google invalido el refresh token. Reconecta Drive.',
      })
    }
    return json(res, 502, {
      code: refreshed.error ?? 'drive_refresh_failed',
      message: refreshed.errorDescription ?? 'Error al renovar access token de Drive.',
    })
  }

  return json(res, 200, {
    accessToken: refreshed.accessToken,
    expiresIn: Number(refreshed.expiresIn ?? 3600),
  })
}

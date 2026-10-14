const DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
]

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'

const requiredEnv = (name) => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing ${name}`)
  }
  return value
}

export const getOauthConfig = () => {
  return {
    clientId: requiredEnv('GOOGLE_OAUTH_CLIENT_ID'),
    clientSecret: requiredEnv('GOOGLE_OAUTH_CLIENT_SECRET'),
    redirectUri: requiredEnv('GOOGLE_OAUTH_REDIRECT_URI'),
  }
}

export const buildAuthorizationUrl = ({ state }) => {
  const { clientId, redirectUri } = getOauthConfig()
  const url = new URL(AUTH_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', DRIVE_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', state)
  return url.toString()
}

const parseTokenError = async (response) => {
  try {
    const json = await response.json()
    return {
      error: json.error,
      errorDescription: json.error_description,
    }
  } catch {
    return {
      error: 'token_exchange_failed',
      errorDescription: `Token endpoint responded ${response.status}`,
    }
  }
}

export const exchangeAuthorizationCode = async (code) => {
  const { clientId, clientSecret, redirectUri } = getOauthConfig()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    return {
      ok: false,
      ...(await parseTokenError(response)),
    }
  }

  const json = await response.json()
  return {
    ok: true,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
    scope: json.scope,
    tokenType: json.token_type,
  }
}

export const refreshDriveAccessToken = async (refreshToken) => {
  const { clientId, clientSecret } = getOauthConfig()
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    return {
      ok: false,
      ...(await parseTokenError(response)),
    }
  }

  const json = await response.json()
  return {
    ok: true,
    accessToken: json.access_token,
    expiresIn: json.expires_in,
    scope: json.scope,
    tokenType: json.token_type,
  }
}

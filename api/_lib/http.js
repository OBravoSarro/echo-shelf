const appendSetCookie = (res, cookie) => {
  const current = res.getHeader('Set-Cookie')
  if (!current) {
    res.setHeader('Set-Cookie', cookie)
    return
  }
  if (Array.isArray(current)) {
    res.setHeader('Set-Cookie', [...current, cookie])
    return
  }
  res.setHeader('Set-Cookie', [current, cookie])
}

export const parseCookies = (req) => {
  const header = req.headers.cookie
  if (!header) return {}
  return header.split(';').reduce((acc, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (!rawKey) return acc
    acc[rawKey] = decodeURIComponent(rawValue.join('='))
    return acc
  }, {})
}

export const setCookie = (res, name, value, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? '/'}`)
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`)
  if (options.httpOnly !== false) parts.push('HttpOnly')
  if (options.secure !== false) parts.push('Secure')
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  if (options.domain) parts.push(`Domain=${options.domain}`)
  appendSetCookie(res, parts.join('; '))
}

export const clearCookie = (res, name, options = {}) => {
  setCookie(res, name, '', {
    ...options,
    maxAge: 0,
  })
}

export const shouldUseSecureCookies = (req) => {
  const forced = process.env.COOKIE_SECURE?.trim().toLowerCase()
  if (forced === 'true') return true
  if (forced === 'false') return false

  const forwardedProtoHeader = req.headers['x-forwarded-proto']
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader?.split(',')[0]
  if (forwardedProto) {
    return forwardedProto.trim() === 'https'
  }

  const hostHeader = req.headers.host
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader
  if (!host) return true
  return !/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host.trim())
}

export const json = (res, status, body) => {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body))
}

export const methodNotAllowed = (res, allowed) => {
  res.setHeader('Allow', allowed)
  json(res, 405, { code: 'method_not_allowed', message: 'Method not allowed' })
}

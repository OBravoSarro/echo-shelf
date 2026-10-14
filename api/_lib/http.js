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

export const json = (res, status, body) => {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').send(JSON.stringify(body))
}

export const methodNotAllowed = (res, allowed) => {
  res.setHeader('Allow', allowed)
  json(res, 405, { code: 'method_not_allowed', message: 'Method not allowed' })
}

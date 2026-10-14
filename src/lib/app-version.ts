export const CURRENT_APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

const normalizeVersion = (value: string): number[] => {
  return value
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((part) => Number(part.replace(/[^0-9].*$/, '')))
    .map((valuePart) => (Number.isFinite(valuePart) ? valuePart : 0))
}

export const compareSemver = (a: string, b: string): number => {
  const aParts = normalizeVersion(a)
  const bParts = normalizeVersion(b)
  const maxLength = Math.max(aParts.length, bParts.length)

  for (let i = 0; i < maxLength; i += 1) {
    const left = aParts[i] ?? 0
    const right = bParts[i] ?? 0
    if (left > right) return 1
    if (left < right) return -1
  }

  return 0
}

export type VersionCheckResult = {
  latestVersion?: string
  upToDate?: boolean
}

export const fetchLatestVersion = async (): Promise<VersionCheckResult> => {
  const response = await fetch(`/version.json?ts=${Date.now()}`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Version endpoint failed: ${response.status}`)
  }

  const payload = (await response.json()) as { version?: string }
  const latestVersion = payload.version?.trim()
  if (!latestVersion) return {}

  return {
    latestVersion,
    upToDate: compareSemver(CURRENT_APP_VERSION, latestVersion) >= 0,
  }
}

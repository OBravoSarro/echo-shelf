import { useEffect, useMemo, useState } from 'react'
import { driveApi } from '../../infrastructure/google-drive/drive-api'
import { fileStorage } from '../../infrastructure/persistence/file-storage'
import { useAuthStore } from '../auth/auth-store'

const coverCache = new Map<string, string>()

const isDriveHostedCoverUrl = (value?: string): boolean => {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return (
      parsed.hostname.includes('drive.google.com') ||
      parsed.hostname.includes('googleusercontent.com') ||
      parsed.searchParams.has('id')
    )
  } catch {
    return false
  }
}

const extractDriveFileIdFromUrl = (url?: string): string | undefined => {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    const id = parsed.searchParams.get('id')
    return id ?? undefined
  } catch {
    return undefined
  }
}

export const useResolvedCover = ({
  bookId,
  source,
  coverFileId,
  coverUrl,
}: {
  bookId?: string
  source: 'drive'
  coverFileId?: string
  coverUrl?: string
}) => {
  const accessToken = useAuthStore((state) => state.accessToken)
  const effectiveCoverFileId = useMemo(() => coverFileId ?? extractDriveFileIdFromUrl(coverUrl), [coverFileId, coverUrl])
  const preferDirectUrl = Boolean(coverUrl && !isDriveHostedCoverUrl(coverUrl))
  const [resolvedCover, setResolvedCover] = useState<string | undefined>(() => {
    if (preferDirectUrl) {
      return coverUrl
    }
    if (source === 'drive' && effectiveCoverFileId) {
      return undefined
    }
    return coverUrl
  })

  useEffect(() => {
    let cancelled = false
    const resolve = async () => {
      if (preferDirectUrl) {
        setResolvedCover(coverUrl)
        return
      }
      if (source === 'drive' && bookId && effectiveCoverFileId) {
        const local = await fileStorage.read(`cover-${bookId}`)
        if (local) {
          const localUrl = URL.createObjectURL(local)
          setResolvedCover(localUrl)
          return
        }
      }
      if (!effectiveCoverFileId || source !== 'drive' || !accessToken) {
        setResolvedCover(coverUrl)
        return
      }
      setResolvedCover(undefined)
      const key = `${effectiveCoverFileId}:${accessToken.slice(0, 12)}`
      if (coverCache.has(key)) {
        setResolvedCover(coverCache.get(key))
        return
      }
      try {
        const blob = await driveApi.download(accessToken, effectiveCoverFileId)
        const objectUrl = URL.createObjectURL(blob)
        coverCache.set(key, objectUrl)
        if (!cancelled) {
          setResolvedCover(objectUrl)
        }
      } catch {
        if (!cancelled) {
          setResolvedCover(coverUrl)
        }
      }
    }
    void resolve()
    return () => {
      cancelled = true
    }
  }, [accessToken, bookId, coverUrl, effectiveCoverFileId, preferDirectUrl, source])

  return resolvedCover
}

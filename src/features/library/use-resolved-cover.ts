import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../auth/auth-store'
import { extractDriveFileIdFromUrl, getCoverObjectUrl, isDriveHostedCoverUrl } from './cover-source'

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
  // Solo como disparador: cuando llega el token se reintenta una portada pendiente.
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
      if (preferDirectUrl || !effectiveCoverFileId || source !== 'drive') {
        setResolvedCover(coverUrl)
        return
      }
      // Local primero (funciona sin red ni sesion); si no esta, se baja y se guarda.
      const url = await getCoverObjectUrl(bookId, effectiveCoverFileId)
      if (!cancelled) setResolvedCover(url ?? coverUrl)
    }
    void resolve()
    return () => {
      cancelled = true
    }
  }, [accessToken, bookId, coverUrl, effectiveCoverFileId, preferDirectUrl, source])

  return resolvedCover
}

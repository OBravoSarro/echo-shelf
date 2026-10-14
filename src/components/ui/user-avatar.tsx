import { useState } from 'react'

type UserAvatarProps = {
  photoUrl?: string
  name?: string
  email?: string
  sizeClassName: string
  textClassName: string
  fallbackClassName: string
}

const normalizePhotoUrl = (value?: string): string | undefined => {
  if (!value) return undefined
  const url = value.trim()
  if (!url) return undefined
  if (url.startsWith('http://')) {
    return `https://${url.slice('http://'.length)}`
  }
  return url
}

export const UserAvatar = ({ photoUrl, name, email, sizeClassName, textClassName, fallbackClassName }: UserAvatarProps) => {
  const [failedUrl, setFailedUrl] = useState<string | undefined>()
  const safePhotoUrl = normalizePhotoUrl(photoUrl)

  if (safePhotoUrl && failedUrl !== safePhotoUrl) {
    return (
      <img
        src={safePhotoUrl}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(safePhotoUrl)}
        className={`${sizeClassName} rounded-full object-cover`}
      />
    )
  }

  return (
    <div className={`grid place-items-center rounded-full ${fallbackClassName} ${sizeClassName} ${textClassName}`}>
      {(name?.[0] ?? email?.[0] ?? 'U').toUpperCase()}
    </div>
  )
}

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const toBase64Url = (buffer) => {
  return buffer.toString('base64url')
}

const fromBase64Url = (value) => {
  return Buffer.from(value, 'base64url')
}

const getEncryptionKey = () => {
  const secret = process.env.TOKEN_ENCRYPTION_KEY
  if (!secret) {
    throw new Error('Missing TOKEN_ENCRYPTION_KEY')
  }
  return createHash('sha256').update(secret).digest()
}

export const encryptJson = (value) => {
  const iv = randomBytes(12)
  const key = getEncryptionKey()
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const payload = Buffer.from(JSON.stringify(value), 'utf8')
  const encrypted = Buffer.concat([cipher.update(payload), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${toBase64Url(iv)}.${toBase64Url(tag)}.${toBase64Url(encrypted)}`
}

export const decryptJson = (value) => {
  const parts = value.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format')
  }
  const [ivPart, tagPart, dataPart] = parts
  const iv = fromBase64Url(ivPart)
  const tag = fromBase64Url(tagPart)
  const encrypted = fromBase64Url(dataPart)
  const key = getEncryptionKey()
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}

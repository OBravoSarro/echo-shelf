import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioTrack } from '../../domain/audiobook'
import { useAuthStore } from '../auth/auth-store'
import { fetchRemoteTrack, isAbortError } from './track-source'

const track: AudioTrack = {
  id: 'track-1',
  bookId: 'book-1',
  title: 'Capitulo 1',
  index: 0,
  format: 'mp3',
  mimeType: 'audio/mpeg',
  driveFileId: 'drive-1',
  fileSize: 6,
}

const streamResponse = (chunks: string[]) => {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-length': String(chunks.join('').length) } })
}

describe('fetchRemoteTrack', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports progress and shares a single request between consumers', async () => {
    useAuthStore.setState({ accessToken: 'token', expiresAt: Date.now() + 3_600_000 })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(streamResponse(['abc', 'def']))
    const progress: number[] = []

    const [a, b] = await Promise.all([
      fetchRemoteTrack(track, { onProgress: ({ loaded }) => progress.push(loaded) }),
      fetchRemoteTrack(track),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
    expect(a.size).toBe(6)
    expect(a.type).toBe('audio/mpeg')
    expect(progress.at(-1)).toBe(6)
  })

  it('keeps the shared download alive when only one consumer aborts', async () => {
    useAuthStore.setState({ accessToken: 'token', expiresAt: Date.now() + 3_600_000 })
    let requestSignal: AbortSignal | undefined
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      requestSignal = init?.signal ?? undefined
      return streamResponse(['abcdef'])
    })
    const controller = new AbortController()
    const first = fetchRemoteTrack(track, { signal: controller.signal })
    const second = fetchRemoteTrack(track)
    controller.abort()

    await expect(first).rejects.toSatisfy(isAbortError)
    await expect(second).resolves.toHaveProperty('size', 6)
    expect(requestSignal?.aborted).toBe(false)
  })
})

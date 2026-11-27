import type { AudioTrack } from '../../domain/audiobook'
import { DriveHttpError, driveApi } from '../../infrastructure/google-drive/drive-api'
import { probeMp3Duration } from '../../lib/mp3-duration'

let running: Promise<void> | undefined

/**
 * Mide la duracion real de los MP3 que aun no la tienen leyendo solo su
 * cabecera en Drive (~64 KB por capitulo). Asi el listado muestra el mismo
 * tiempo que luego da el reproductor, sin tener que escucharlos o bajarlos.
 * Va de uno en uno: `save` no admite escrituras concurrentes del mismo libro.
 */
export const probeMissingDurations = (
  tracks: AudioTrack[],
  accessToken: string,
  save: (bookId: string, trackId: string, seconds: number) => Promise<void>,
): Promise<void> => {
  if (running) return running
  const pending = tracks.filter(
    (track) => track.format === 'mp3' && track.driveFileId && track.fileSize && !(Number(track.durationSeconds ?? 0) > 0),
  )
  if (pending.length === 0) return Promise.resolve()
  running = (async () => {
    for (const track of pending) {
      if (!navigator.onLine) return
      try {
        const fileId = track.driveFileId as string
        const seconds = await probeMp3Duration(
          (start, end) => driveApi.downloadRange(accessToken, fileId, start, end),
          Number(track.fileSize),
        )
        if (seconds) await save(track.bookId, track.id, seconds)
      } catch (error) {
        // Token caducado o sin red: se deja para la proxima sincronizacion.
        // Un archivo raro solo se salta (se queda con la estimacion).
        if (!(error instanceof DriveHttpError) || error.status === 401 || error.status === 403) return
      }
    }
  })().finally(() => {
    running = undefined
  })
  return running
}

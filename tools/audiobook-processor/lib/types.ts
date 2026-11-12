export interface Chapter {
  index: number
  title: string
  start: number
  end: number
}

export interface BookMeta {
  title: string
  author: string
  narrator: string
  year?: string
  genre?: string
}

export interface CoverStream {
  streamIndex: number
  codec: string
}

export interface ProbeResult {
  file: string
  sizeBytes: number
  duration: number
  codec: string
  bitrate?: number
  sampleRate?: number
  channels?: number
  chapters: Chapter[]
  meta: BookMeta
  cover?: CoverStream
}

export type VoicePreset = 'soft' | 'strong'

export type PreviewMode = 'original' | VoicePreset

export interface ChapterSelection {
  title: string
  start: number
  end: number
}

export interface ProcessRequest {
  file: string
  folderName: string
  meta: BookMeta
  chapters: ChapterSelection[]
  enhance: boolean
  preset: VoicePreset
  bitrateKbps: number
}

export type ChapterJobStatus = 'pending' | 'running' | 'done' | 'error'

export interface ChapterJobState {
  position: number
  title: string
  fileName: string
  duration: number
  progress: number
  status: ChapterJobStatus
  error?: string
}

export type JobStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface JobState {
  id: string
  file: string
  folderName: string
  outputDir: string
  enhance: boolean
  preset: VoicePreset
  status: JobStatus
  startedAt: number
  finishedAt?: number
  chapters: ChapterJobState[]
  log: string[]
  error?: string
}

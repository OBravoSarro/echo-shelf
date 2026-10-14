export interface DriveFile {
  id: string
  name: string
  mimeType: string
  parents?: string[]
  size?: string
  modifiedTime?: string
  webViewLink?: string
  thumbnailLink?: string
  imageMediaMetadata?: {
    width?: number
    height?: number
  }
  videoMediaMetadata?: {
    durationMillis?: string
  }
}

export interface DriveListResponse {
  files: DriveFile[]
  nextPageToken?: string
}

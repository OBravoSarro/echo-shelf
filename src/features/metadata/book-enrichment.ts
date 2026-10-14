import { z } from 'zod'
import { env } from '../../lib/env'

const openLibrarySearchSchema = z.object({
  docs: z.array(
    z.object({
      key: z.string().optional(),
      title: z.string().optional(),
      author_name: z.array(z.string()).optional(),
      isbn: z.array(z.string()).optional(),
      first_publish_year: z.number().optional(),
      cover_i: z.number().optional(),
      subject: z.array(z.string()).optional(),
      publisher: z.array(z.string()).optional(),
      language: z
        .array(
          z.union([
            z.string(),
            z.object({
              key: z.string().optional(),
            }),
          ]),
        )
        .optional(),
    }),
  ),
})

const openLibraryWorkSchema = z.object({
  description: z.union([z.string(), z.object({ value: z.string() })]).optional(),
})

const googleBooksSchema = z.object({
  items: z
    .array(
      z.object({
        volumeInfo: z
          .object({
            title: z.string().optional(),
            authors: z.array(z.string()).optional(),
            description: z.string().optional(),
            categories: z.array(z.string()).optional(),
            publishedDate: z.string().optional(),
            publisher: z.string().optional(),
            imageLinks: z
              .object({
                thumbnail: z.string().optional(),
                smallThumbnail: z.string().optional(),
              })
              .optional(),
            industryIdentifiers: z
              .array(
                z.object({
                  type: z.string().optional(),
                  identifier: z.string().optional(),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .optional(),
})

export interface EnrichedMetadataCandidate {
  source: 'openlibrary' | 'googlebooks'
  title: string
  author: string
  isbn?: string
  description?: string
  coverUrl?: string
  publishedYear?: number
  genres?: string[]
  publisher?: string
}

const extractOpenLibraryDescription = (value: unknown): string | undefined => {
  const parsed = openLibraryWorkSchema.safeParse(value)
  if (!parsed.success) return undefined
  const desc = parsed.data.description
  if (!desc) return undefined
  return typeof desc === 'string' ? desc : desc.value
}

const AUTHOR_PLACEHOLDERS = ['autor sin clasificar', 'unknown author', 'desconocido']
const SPANISH_HINTS = [' y ', ' de ', ' del ', ' la ', ' el ', ' los ', ' las ', ' una ', ' un ', 'en']

const normalizeQueryText = (value: string): string => {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[[\]{}()]/g, ' ')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const sanitizeAuthor = (author?: string): string | undefined => {
  const safe = author?.trim()
  if (!safe) return undefined
  const lowered = safe.toLowerCase()
  if (AUTHOR_PLACEHOLDERS.some((placeholder) => lowered.includes(placeholder))) {
    return undefined
  }
  return normalizeQueryText(safe)
}

const sanitizeTitle = (title: string): string => {
  const normalized = normalizeQueryText(title)
  return normalized
    .replace(/^\d+\s*[-_.]?\s*/, '')
    .replace(/\b(capitulo|chapter|parte|track|tomo)\b\s*\d+$/i, '')
    .trim()
}

const normalizeAsin = (asin?: string): string | undefined => {
  if (!asin) return undefined
  const cleaned = asin.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
  if (/^[A-Z0-9]{10}$/.test(cleaned)) {
    return cleaned
  }
  return undefined
}

const normalizeIsbn = (isbn?: string): string | undefined => {
  if (!isbn) return undefined
  const cleaned = isbn.replace(/[^0-9Xx]/g, '').toUpperCase()
  if (/^(97[89][0-9]{10}|[0-9]{9}[0-9X])$/.test(cleaned)) {
    return cleaned
  }
  return undefined
}

const extractIsbnFromText = (value?: string): string | undefined => {
  if (!value) return undefined
  const matches = value.match(/\b(?:97[89][0-9\-\s]{10,16}|[0-9Xx\-\s]{10,13})\b/g)
  if (!matches) return undefined
  for (const candidate of matches) {
    const normalized = normalizeIsbn(candidate)
    if (normalized) return normalized
  }
  return undefined
}

const extractAsinFromText = (value?: string): string | undefined => {
  if (!value) return undefined
  const match = value.toUpperCase().match(/\b[A-Z0-9]{10}\b/)
  if (!match) return undefined
  return normalizeAsin(match[0])
}

const stringSimilarityScore = (target: string, candidate: string): number => {
  const left = normalizeQueryText(target).toLowerCase()
  const right = normalizeQueryText(candidate).toLowerCase()
  if (!left || !right) return 0
  if (left === right) return 1
  if (right.includes(left)) return 0.88
  if (left.includes(right)) return 0.82
  const leftTokens = new Set(left.split(' ').filter(Boolean))
  const rightTokens = new Set(right.split(' ').filter(Boolean))
  const common = [...leftTokens].filter((token) => rightTokens.has(token)).length
  if (common === 0) return 0
  return common / Math.max(leftTokens.size, rightTokens.size)
}

const isSpanishLanguageCode = (value: string): boolean => {
  const lowered = value.toLowerCase()
  return lowered.includes('spa') || lowered.endsWith('/languages/spa') || lowered === 'es'
}

const hasSpanishHint = (value: string): boolean => {
  const normalized = ` ${normalizeQueryText(value).toLowerCase()} `
  return SPANISH_HINTS.some((hint) => normalized.includes(hint))
}

const scoreCandidate = (
  input: { title: string; author?: string; isbn?: string; asin?: string },
  candidate: EnrichedMetadataCandidate,
): number => {
  let score = 0
  score += stringSimilarityScore(input.title, candidate.title) * 60
  if (input.author) {
    score += stringSimilarityScore(input.author, candidate.author) * 28
  }
  if (input.isbn && candidate.isbn && input.isbn === candidate.isbn) {
    score += 65
  }
  if (input.asin && candidate.isbn && input.asin === candidate.isbn) {
    score += 32
  }
  if (hasSpanishHint(candidate.title)) {
    score += 10
  }
  if (candidate.description && hasSpanishHint(candidate.description)) {
    score += 6
  }
  if (candidate.source === 'openlibrary') {
    score += 4
  }
  return score
}

const fetchOpenLibraryByIsbn = async (isbn: string): Promise<EnrichedMetadataCandidate[]> => {
  const url = new URL('https://openlibrary.org/api/books')
  url.searchParams.set('bibkeys', `ISBN:${isbn}`)
  url.searchParams.set('format', 'json')
  url.searchParams.set('jscmd', 'data')

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Open Library ISBN failed: ${response.status}`)
  }
  const json = (await response.json()) as Record<string, {
    title?: string
    subtitle?: string
    by_statement?: string
    authors?: Array<{ name?: string }>
    publish_date?: string
    publishers?: Array<{ name?: string }>
    cover?: { medium?: string; large?: string; small?: string }
    subjects?: Array<{ name?: string }>
    notes?: string
  }>
  const key = `ISBN:${isbn}`
  const item = json[key]
  if (!item?.title) return []
  const yearCandidate = item.publish_date?.match(/(19|20)\d{2}/)?.[0]
  return [
    {
      source: 'openlibrary',
      title: item.subtitle ? `${item.title}: ${item.subtitle}` : item.title,
      author: item.authors?.[0]?.name ?? item.by_statement ?? 'Autor sin clasificar',
      description: item.notes,
      coverUrl: item.cover?.large ?? item.cover?.medium ?? item.cover?.small,
      publishedYear: yearCandidate ? Number(yearCandidate) : undefined,
      genres: item.subjects?.map((subject) => subject.name).filter(Boolean).slice(0, 5) as string[] | undefined,
      publisher: item.publishers?.[0]?.name,
      isbn,
    },
  ]
}

const fetchOpenLibrary = async (title: string, author?: string): Promise<EnrichedMetadataCandidate[]> => {
  const runSearch = async (query: URL): Promise<z.infer<typeof openLibrarySearchSchema>> => {
    const response = await fetch(query.toString())
    if (!response.ok) {
      throw new Error(`Open Library failed: ${response.status}`)
    }
    const json = await response.json()
    return openLibrarySearchSchema.parse(json)
  }

  const primary = new URL('https://openlibrary.org/search.json')
  primary.searchParams.set('title', title)
  if (author) primary.searchParams.set('author', author)
  primary.searchParams.set('limit', '8')

  const spanish = new URL('https://openlibrary.org/search.json')
  spanish.searchParams.set('q', author ? `${title} ${author} language:spa` : `${title} language:spa`)
  spanish.searchParams.set('limit', '8')

  const fallback = new URL('https://openlibrary.org/search.json')
  fallback.searchParams.set('q', author ? `${title} ${author}` : title)
  fallback.searchParams.set('limit', '8')

  const [primaryResult, spanishResult, fallbackResult] = await Promise.all([
    runSearch(primary),
    runSearch(spanish),
    runSearch(fallback),
  ])

  const docs = [...primaryResult.docs, ...spanishResult.docs, ...fallbackResult.docs]
  const uniqueDocs = new Map<string, z.infer<typeof openLibrarySearchSchema>['docs'][number]>()
  for (const doc of docs) {
    const key = doc.key ?? `${doc.title ?? ''}:${doc.author_name?.[0] ?? ''}`
    if (!uniqueDocs.has(key)) {
      uniqueDocs.set(key, doc)
    }
  }

  const candidates = await Promise.all(
    [...uniqueDocs.values()].slice(0, 12).map(async (doc) => {
      let description: string | undefined
      if (doc.key?.startsWith('/works/')) {
        try {
          const workResponse = await fetch(`https://openlibrary.org${doc.key}.json`)
          if (workResponse.ok) {
            const workJson = await workResponse.json()
            description = extractOpenLibraryDescription(workJson)
          }
        } catch {
          description = undefined
        }
      }
      const coverUrl = doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg` : undefined
      const isbn = doc.isbn?.map((value) => normalizeIsbn(value)).find(Boolean)
      const hasSpanishLanguage = (doc.language ?? []).some((language) => {
        if (typeof language === 'string') {
          return isSpanishLanguageCode(language)
        }
        return language.key ? isSpanishLanguageCode(language.key) : false
      })
      return {
        source: 'openlibrary' as const,
        title: doc.title ?? title,
        author: doc.author_name?.[0] ?? author ?? 'Autor sin clasificar',
        isbn,
        description,
        coverUrl,
        publishedYear: doc.first_publish_year,
        genres: doc.subject?.slice(0, 5),
        publisher: doc.publisher?.[0],
        hasSpanishLanguage,
      }
    }),
  )
  return candidates
    .filter((item) => item.title)
    .map((item) => {
      const { hasSpanishLanguage, ...clean } = item
      if (hasSpanishLanguage && clean.description) {
        return clean
      }
      return clean
    })
}

const fetchGoogleBooks = async (title: string, author?: string): Promise<EnrichedMetadataCandidate[]> => {
  if (!env.enableGoogleBooks) {
    return []
  }

  const query = [`intitle:${title}`]
  if (author) query.push(`inauthor:${author}`)
  const url = new URL('https://www.googleapis.com/books/v1/volumes')
  url.searchParams.set('q', query.join('+'))
  url.searchParams.set('maxResults', '5')
  url.searchParams.set('langRestrict', 'es')
  if (env.googleBooksApiKey) {
    url.searchParams.set('key', env.googleBooksApiKey)
  }

  const response = await fetch(url.toString())
  if (response.status === 429) {
    return []
  }
  if (!response.ok) {
    throw new Error(`Google Books failed: ${response.status}`)
  }
  const json = await response.json()
  const parsed = googleBooksSchema.parse(json)
  const isDefined = <T>(value: T | undefined): value is T => value !== undefined

  return (parsed.items ?? [])
    .map((item) => {
      const info = item.volumeInfo
      if (!info?.title) return undefined
      const publishedYear = info.publishedDate ? Number(info.publishedDate.slice(0, 4)) : undefined
      const foundIsbn = info.industryIdentifiers?.map((identifier) => normalizeIsbn(identifier.identifier)).find(Boolean)
      return {
        source: 'googlebooks' as const,
        title: info.title,
        author: info.authors?.[0] ?? author ?? 'Autor sin clasificar',
        description: info.description,
        coverUrl: info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail,
        publishedYear: Number.isFinite(publishedYear) ? publishedYear : undefined,
        genres: info.categories?.slice(0, 5),
        publisher: info.publisher,
        isbn: foundIsbn,
      }
    })
    .filter(isDefined)
}

const fetchGoogleBooksByIsbn = async (isbn: string): Promise<EnrichedMetadataCandidate[]> => {
  if (!env.enableGoogleBooks) {
    return []
  }

  const url = new URL('https://www.googleapis.com/books/v1/volumes')
  url.searchParams.set('q', `isbn:${isbn}`)
  url.searchParams.set('maxResults', '5')
  if (env.googleBooksApiKey) {
    url.searchParams.set('key', env.googleBooksApiKey)
  }

  const response = await fetch(url.toString())
  if (response.status === 429) {
    return []
  }
  if (!response.ok) {
    throw new Error(`Google Books failed: ${response.status}`)
  }
  const json = await response.json()
  const parsed = googleBooksSchema.parse(json)
  const isDefined = <T>(value: T | undefined): value is T => value !== undefined

  return (parsed.items ?? [])
    .map((item) => {
      const info = item.volumeInfo
      if (!info?.title) return undefined
      const publishedYear = info.publishedDate ? Number(info.publishedDate.slice(0, 4)) : undefined
      const foundIsbn = info.industryIdentifiers?.map((identifier) => normalizeIsbn(identifier.identifier)).find(Boolean)
      return {
        source: 'googlebooks' as const,
        title: info.title,
        author: info.authors?.[0] ?? 'Autor sin clasificar',
        description: info.description,
        coverUrl: info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail,
        publishedYear: Number.isFinite(publishedYear) ? publishedYear : undefined,
        genres: info.categories?.slice(0, 5),
        publisher: info.publisher,
        isbn: foundIsbn,
      }
    })
    .filter(isDefined)
}

export const searchBookMetadata = async (title: string, author?: string, isbn?: string): Promise<EnrichedMetadataCandidate[]> => {
  const normalizedTitle = sanitizeTitle(title)
  const normalizedIsbn = normalizeIsbn(isbn) ?? extractIsbnFromText(normalizedTitle)
  const normalizedAsin = extractAsinFromText(title)
  if (!normalizedTitle && !normalizedIsbn) return []
  const safeAuthor = sanitizeAuthor(author)
  const tasks: Array<Promise<EnrichedMetadataCandidate[]>> = []

  if (normalizedIsbn) {
    tasks.push(fetchOpenLibraryByIsbn(normalizedIsbn))
    tasks.push(fetchGoogleBooksByIsbn(normalizedIsbn))
  }

  if (normalizedTitle) {
    tasks.push(fetchOpenLibrary(normalizedTitle, safeAuthor))
    tasks.push(fetchGoogleBooks(normalizedTitle, safeAuthor))
    if (normalizedAsin) {
      tasks.push(fetchOpenLibrary(normalizedAsin, safeAuthor))
    }
  }

  const settled = await Promise.allSettled(tasks)

  const results: EnrichedMetadataCandidate[] = []
  for (const task of settled) {
    if (task.status === 'fulfilled') {
      results.push(...task.value)
    }
  }

  const unique = new Map<string, EnrichedMetadataCandidate>()
  for (const item of results) {
    const key = `${item.title.toLowerCase()}::${item.author.toLowerCase()}`
    if (!unique.has(key)) {
      unique.set(key, item)
    }
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        scoreCandidate({ title: normalizedTitle, author: safeAuthor, isbn: normalizedIsbn, asin: normalizedAsin }, b) -
        scoreCandidate({ title: normalizedTitle, author: safeAuthor, isbn: normalizedIsbn, asin: normalizedAsin }, a),
    )
    .slice(0, 8)
}

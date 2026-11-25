import assert from 'node:assert/strict'
import test from 'node:test'
import { AxiosInstance } from 'axios'
import { BibleApiClient } from './bibleApiClient'
import { BOOK_ENTRIES } from './bookEntries'
import { resolveBookId } from './bookResolver'

type StubHandler = (path: string) => { data: unknown }

const createStubClient = (handler: StubHandler) => {
  let callCount = 0
  const httpClient = {
    get: async (path: string) => {
      callCount += 1
      return handler(path)
    },
  } as unknown as AxiosInstance

  return { httpClient, getCallCount: () => callCount }
}

const makeBollsBooksFixture = () =>
  BOOK_ENTRIES.map((entry) => ({
    bookid: entry.id,
    name: entry.spanish,
    chapters: entry.id === 1 ? 50 : entry.id === 66 ? 22 : 1,
  }))

test('getChapter returns a full chapter with sanitized text', async () => {
  const { httpClient } = createStubClient((path) => {
    if (path === '/get-books/RV1960/') {
      return { data: [{ bookid: 43, name: 'Juan', chapters: 21 }] }
    }
    assert.equal(path, '/get-text/RV1960/43/3/')
    return {
      data: [
        { pk: 1, verse: 1, text: 'De tal manera<br> amó Dios al mundo' },
        { pk: 2, verse: 2, text: 'Porque no envió Dios a su Hijo' },
      ],
    }
  })
  const client = new BibleApiClient('https://bolls.life', httpClient)

  const chapter = await client.getChapter({ versionCode: 'rv1960', book: 'juan', chapter: 3 })

  assert.equal(chapter.chapter, 3)
  assert.equal(chapter.testament, 'new')
  assert.equal(chapter.name, 'Juan')
  assert.equal(chapter.verses.length, 2)
  assert.deepEqual(chapter.verses[0], {
    number: 1,
    text: 'De tal manera amó Dios al mundo',
  })
  assert.deepEqual(chapter.verses[1], {
    number: 2,
    text: 'Porque no envió Dios a su Hijo',
  })
})

test('getChapter requests the provider using the catalog provider code and resolved book id', async () => {
  const { httpClient } = createStubClient((path) => {
    if (path === '/get-books/KJV/') {
      return { data: [{ bookid: 1, name: 'Genesis', chapters: 50 }] }
    }
    assert.equal(path, '/get-text/KJV/1/1/')
    return { data: [{ pk: 1, verse: 1, text: 'In the beginning' }] }
  })
  const client = new BibleApiClient('https://bolls.life', httpClient)

  const chapter = await client.getChapter({ versionCode: 'kjv', book: 'GN', chapter: 1 })

  assert.equal(chapter.testament, 'old')
  assert.equal(chapter.verses.length, 1)
})

test('getVerses returns a single verse', async () => {
  const { httpClient } = createStubClient((path) => {
    if (path === '/get-books/RV1960/') {
      return { data: [{ bookid: 43, name: 'Juan', chapters: 21 }] }
    }
    return {
      data: [
        { pk: 1, verse: 15, text: 'Verso 15' },
        { pk: 2, verse: 16, text: 'Verso 16' },
        { pk: 3, verse: 17, text: 'Verso 17' },
      ],
    }
  })
  const client = new BibleApiClient('https://bolls.life', httpClient)

  const verses = await client.getVerses({
    versionCode: 'rv1960',
    book: 'juan',
    chapter: 3,
    fromVerse: 16,
  })

  assert.equal(verses.length, 1)
  assert.deepEqual(verses[0], { verse: 'Verso 16', number: 16 })
})

test('getVerses returns a contiguous range in ascending order', async () => {
  const { httpClient } = createStubClient((path) => {
    if (path === '/get-books/RV1960/') {
      return { data: [{ bookid: 43, name: 'Juan', chapters: 21 }] }
    }
    return {
      data: [
        { pk: 1, verse: 15, text: 'Verso 15' },
        { pk: 2, verse: 16, text: 'Verso 16' },
        { pk: 3, verse: 17, text: 'Verso 17' },
        { pk: 4, verse: 18, text: 'Verso 18' },
        { pk: 5, verse: 19, text: 'Verso 19' },
      ],
    }
  })
  const client = new BibleApiClient('https://bolls.life', httpClient)

  const verses = await client.getVerses({
    versionCode: 'rv1960',
    book: 'juan',
    chapter: 3,
    fromVerse: 16,
    toVerse: 18,
  })

  assert.deepEqual(
    verses.map((v) => v.number),
    [16, 17, 18],
  )
})

test('getVerses stops at the end of the chapter when the range goes past it', async () => {
  const chapterVerses = Array.from({ length: 36 }, (_, index) => ({
    pk: index + 1,
    verse: index + 1,
    text: `Verso ${index + 1}`,
  }))
  const { httpClient } = createStubClient((path) => {
    if (path === '/get-books/RV1960/') {
      return { data: [{ bookid: 43, name: 'Juan', chapters: 21 }] }
    }
    return { data: chapterVerses }
  })
  const client = new BibleApiClient('https://bolls.life', httpClient)

  const verses = await client.getVerses({
    versionCode: 'rv1960',
    book: 'juan',
    chapter: 3,
    fromVerse: 35,
    toVerse: 40,
  })

  assert.deepEqual(
    verses.map((v) => v.number),
    [35, 36],
  )
})

test('getChapter returns an empty chapter without throwing when the provider responds with []', async () => {
  const { httpClient } = createStubClient((path) => {
    if (path === '/get-books/RV1960/') {
      return { data: [{ bookid: 43, name: 'Juan', chapters: 21 }] }
    }
    return { data: [] }
  })
  const client = new BibleApiClient('https://bolls.life', httpClient)

  const chapter = await client.getChapter({ versionCode: 'rv1960', book: 'juan', chapter: 99 })

  assert.deepEqual(chapter.verses, [])
})

test('getChapter throws for an unknown book before any network call', async () => {
  const { httpClient, getCallCount } = createStubClient(() => ({ data: [] }))
  const client = new BibleApiClient('https://bolls.life', httpClient)

  await assert.rejects(() =>
    client.getChapter({ versionCode: 'rv1960', book: 'not-a-book', chapter: 1 }),
  )
  assert.equal(getCallCount(), 0)
})

test('getChapter throws for an unknown version before any network call', async () => {
  const { httpClient, getCallCount } = createStubClient(() => ({ data: [] }))
  const client = new BibleApiClient('https://bolls.life', httpClient)

  await assert.rejects(() =>
    client.getChapter({ versionCode: 'nvi', book: 'juan', chapter: 1 }),
  )
  assert.equal(getCallCount(), 0)
})

test('getVerses throws for an unknown version before any network call', async () => {
  const { httpClient, getCallCount } = createStubClient(() => ({ data: [] }))
  const client = new BibleApiClient('https://bolls.life', httpClient)

  await assert.rejects(() =>
    client.getVerses({ versionCode: 'rv1995', book: 'juan', chapter: 1, fromVerse: 1 }),
  )
  assert.equal(getCallCount(), 0)
})

test('getChapter sanitizes Strong\'s number annotations from verse text', async () => {
  const { httpClient } = createStubClient((path) => {
    if (path === '/get-books/KJV/') {
      return { data: [{ bookid: 43, name: 'John', chapters: 21 }] }
    }
    return {
      data: [
        {
          pk: 1,
          verse: 16,
          text: 'For<S>1063</S> God<S>2316</S> so<S>3779</S> loved<S>25</S> the world<S>2889</S>',
        },
      ],
    }
  })
  const client = new BibleApiClient('https://bolls.life', httpClient)

  const chapter = await client.getChapter({ versionCode: 'kjv', book: 'juan', chapter: 3 })

  assert.equal(chapter.verses[0].text, 'For God so loved the world')
})

test('getBooks returns the 66-book list with legacy abbreviations and testaments', async () => {
  const { httpClient } = createStubClient((path) => {
    assert.equal(path, '/get-books/RV1960/')
    return { data: makeBollsBooksFixture() }
  })
  const client = new BibleApiClient('https://bolls.life', httpClient)

  const books = await client.getBooks()

  assert.equal(books.length, 66)

  const first = books[0]
  assert.equal(first.name, 'Génesis')
  assert.equal(first.chapters, 50)
  assert.equal(first.testament, 'old')

  const last = books[65]
  assert.equal(last.name, 'Apocalipsis')
  assert.equal(last.chapters, 22)
  assert.equal(last.testament, 'new')
})

test('every abbrev returned by getBooks resolves back to the same book id', async () => {
  const fixture = makeBollsBooksFixture()
  const { httpClient } = createStubClient(() => ({ data: fixture }))
  const client = new BibleApiClient('https://bolls.life', httpClient)

  const books = await client.getBooks()

  books.forEach((book, index) => {
    const bookId = fixture[index].bookid
    assert.ok(book.abbrev, `expected an abbreviation for book id ${bookId}`)
    assert.equal(resolveBookId(book.abbrev), bookId)
  })
})

test('getChapter falls back to the bundled chapter count and name when the books list is unavailable', async () => {
  const { httpClient } = createStubClient((path) => {
    if (path === '/get-books/RV1960/') {
      throw new Error('books list unavailable')
    }
    assert.equal(path, '/get-text/RV1960/1/1/')
    return {
      data: [{ pk: 1, verse: 1, text: 'En el principio creó Dios los cielos y la tierra' }],
    }
  })
  const client = new BibleApiClient('https://bolls.life', httpClient)

  const chapter = await client.getChapter({ versionCode: 'rv1960', book: 'GN', chapter: 1 })

  assert.equal(chapter.name, 'Génesis')
  assert.equal(chapter.numChapters, 50)
  assert.notEqual(chapter.numChapters, 0)
})

test('bundled chapter counts cover the 66-book Protestant canon and sum to 1189', () => {
  assert.equal(BOOK_ENTRIES.length, 66)
  const total = BOOK_ENTRIES.reduce((sum, entry) => sum + entry.chapters, 0)
  assert.equal(total, 1189)
})

test('getBooks caches the books list and does not hit the HTTP stub on a second call', async () => {
  const { httpClient, getCallCount } = createStubClient(() => ({
    data: makeBollsBooksFixture(),
  }))
  const client = new BibleApiClient('https://bolls.life', httpClient)

  await client.getBooks()
  assert.equal(getCallCount(), 1)

  await client.getBooks()
  assert.equal(getCallCount(), 1)
})

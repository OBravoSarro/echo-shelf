import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { LibraryPage } from './library-page'
import { useLibraryStore } from './library-store'

describe('library page', () => {
  it('renders main sections', () => {
    useLibraryStore.setState({
      source: 'drive',
      books: [
        {
          id: 'book-1',
          source: 'drive',
          title: 'Echo One',
          author: 'Autor',
          narrator: 'Narrador',
          totalDurationSeconds: 1200,
          trackCount: 1,
          updatedAt: new Date().toISOString(),
        },
      ],
      tracksByBook: {},
      progressByBook: {},
      loading: false,
      error: undefined,
    })
    render(
      <MemoryRouter>
        <LibraryPage />
      </MemoryRouter>,
    )
    expect(screen.getByText('EchoShelf')).toBeInTheDocument()
    expect(screen.getByText('Tu biblioteca de audiolibros')).toBeInTheDocument()
  })
})

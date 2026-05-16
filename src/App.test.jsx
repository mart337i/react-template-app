import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App.jsx'

describe('App', () => {
  it('renders the template headline', () => {
    render(<App />)

    expect(
      screen.getByRole('heading', {
        name: /ship a tested react app in an nginx container/i,
      }),
    ).toBeInTheDocument()
  })
})

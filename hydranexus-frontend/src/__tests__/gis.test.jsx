// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import LTownMap from '../components/LTownMap'
import LTownMapModal from '../components/LTownMapModal'
import ValidationPage from '../components/ValidationPage'

// Stub fetch (ValidationPage mounts with fetch calls)
vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))

describe('LTownMap runtime safety', () => {
  it('renders the full network without crashing', () => {
    const { container } = render(
      <LTownMap reactedSensor="n215" activeLeaks={['p31', 'p257']} focus="n215" />,
    )
    expect(container.querySelector('.ltown-map')).toBeTruthy()
  })

  it('renders modal wrapper without crashing', () => {
    const { container } = render(
      <LTownMapModal isOpen onClose={vi.fn()} reactedSensor="n215" activeLeaks={['p31']} />,
    )
    expect(container.textContent).toContain('L-Town Network GIS')
  })
})

describe('ValidationPage runtime safety', () => {
  it('renders loading state without crashing', () => {
    const { container } = render(<ValidationPage />)
    expect(container).toBeTruthy()
  })
})

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'

// --- Browser API stubs that jsdom lacks but the real app assumes ---
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)
vi.stubGlobal(
  'matchMedia',
  vi.fn().mockReturnValue({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() }),
)
vi.stubGlobal('scrollTo', vi.fn())
vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {}))) // pending promises = loading states

import App from '../App'

describe('Full App mount (real-mode path)', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    window.sessionStorage.setItem('hydranexus_briefing_seen', '1') // skip cinematic landing
  })

  it('mounts the dashboard without crashing', () => {
    const { container } = render(<App />)
    expect(container.textContent.length).toBeGreaterThan(50)
  })
})

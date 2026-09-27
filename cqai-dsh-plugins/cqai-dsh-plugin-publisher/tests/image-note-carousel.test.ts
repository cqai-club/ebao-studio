import { describe, expect, it } from 'vitest'
import { carouselIndex } from '../src/client/image-note-carousel.tsx'

describe('image-note carousel page selection', () => {
  it('tracks a horizontal swipe and clamps the visible page after image changes', () => {
    expect(carouselIndex(0, 320, 3)).toBe(0)
    expect(carouselIndex(200, 320, 3)).toBe(1)
    expect(carouselIndex(640, 320, 3)).toBe(2)
    expect(carouselIndex(640, 320, 1)).toBe(0)
    expect(carouselIndex(-100, 320, 3)).toBe(0)
    expect(carouselIndex(2000, 320, 3)).toBe(2)
    expect(carouselIndex(300, 0, 3)).toBe(0)
  })
})

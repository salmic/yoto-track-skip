import { describe, expect, it } from 'vitest'
import { normalizeCardContent } from './content.js'

describe('normalizeCardContent', () => {
  it('reads chapters from getContent response shape', () => {
    const content = normalizeCardContent('abc12', {
      card: {
        cardId: 'abc12',
        title: 'Story Book',
        content: {
          chapters: [
            {
              key: '01',
              title: 'Chapter 1',
              tracks: [{ key: 't1', title: 'Opening' }]
            }
          ]
        }
      }
    })

    expect(content.title).toBe('Story Book')
    expect(content.chapters).toHaveLength(1)
    expect(content.chapters[0]?.tracks[0]?.trackKey).toBe('t1')
  })

  it('reads chapters from MYO list shape', () => {
    const content = normalizeCardContent('xyz99', {
      cardId: 'xyz99',
      title: 'MYO Card',
      content: {
        chapters: [
          {
            key: '01',
            title: 'Part 1',
            tracks: [{ key: 'a', title: 'Track A' }]
          }
        ]
      }
    })

    expect(content.chapters[0]?.tracks[0]?.title).toBe('Track A')
  })
})

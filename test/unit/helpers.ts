import { vi } from 'vitest'
import type { CaptchaFetch, CaptchaServerContext } from '../../src/runtime/types'

export interface Call { url: string, init: Parameters<CaptchaFetch>[1] }

/** A fetch that answers from a script and records every call. No network. */
export function mockFetch(...answers: Array<{ status: number, data?: unknown } | Error>) {
  const calls: Call[] = []
  const fetch = vi.fn<CaptchaFetch>(async (url, init) => {
    calls.push({ url, init })
    const answer = answers.length > 1 ? answers.shift()! : answers[0]!
    if (answer instanceof Error) throw answer
    return { status: answer.status, data: answer.data }
  })
  return { fetch, calls }
}

export function serverContext<O>(name: string, options: O, secrets: Record<string, string>, fetch: CaptchaFetch, production = false): CaptchaServerContext<O> {
  return { name, options, secrets, fetch, production, timeout: 5000 }
}

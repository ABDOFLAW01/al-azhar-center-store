import 'reflect-metadata'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { test } from 'node:test'

test('chatbot retries transient provider outages and connection failures', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'azhar-chatbot-test-'))
  const previousDatabase = process.env.AZHAR_STORE_DB
  const previousApiKey = process.env.CHATBOT_API_KEY
  const previousApiUrl = process.env.CHATBOT_API_URL
  const previousModel = process.env.CHATBOT_MODEL
  const originalFetch = globalThis.fetch
  const providerUrl = 'https://gemini.test/chat/completions'
  let providerRequests = 0

  process.env.AZHAR_STORE_DB = join(directory, 'test.sqlite')
  process.env.CHATBOT_API_KEY = 'test-key'
  process.env.CHATBOT_API_URL = providerUrl
  process.env.CHATBOT_MODEL = 'gemini-3.8-flash'
  globalThis.fetch = (async (input, init) => {
    if (String(input) === providerUrl) {
      providerRequests += 1
      if (providerRequests <= 3) return new Response('temporary outage', { status: 503, headers: { 'Retry-After': '0' } })
      if (providerRequests === 5) {
        const cause = Object.assign(new Error('socket reset'), { code: 'ECONNRESET' })
        throw new TypeError('fetch failed', { cause })
      }
      return new Response(JSON.stringify({ choices: [{ message: { content: 'أهلاً بك' } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return originalFetch(input, init)
  }) as typeof fetch

  const app = await NestFactory.create(AppModule, { logger: false })
  try {
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    async function sendMessage() {
      const response = await originalFetch(`http://127.0.0.1:${address.port}/api/chatbot/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      })
      return { response, data: await response.json() as { reply?: string } }
    }

    const afterProvider503 = await sendMessage()
    assert.equal(afterProvider503.response.status, 201)
    assert.equal(afterProvider503.data.reply, 'أهلاً بك')

    const afterConnectionReset = await sendMessage()
    assert.equal(afterConnectionReset.response.status, 201)
    assert.equal(afterConnectionReset.data.reply, 'أهلاً بك')
    assert.equal(providerRequests, 6)
  } finally {
    await app.close()
    globalThis.fetch = originalFetch
    if (previousDatabase === undefined) delete process.env.AZHAR_STORE_DB
    else process.env.AZHAR_STORE_DB = previousDatabase
    if (previousApiKey === undefined) delete process.env.CHATBOT_API_KEY
    else process.env.CHATBOT_API_KEY = previousApiKey
    if (previousApiUrl === undefined) delete process.env.CHATBOT_API_URL
    else process.env.CHATBOT_API_URL = previousApiUrl
    if (previousModel === undefined) delete process.env.CHATBOT_MODEL
    else process.env.CHATBOT_MODEL = previousModel
    rmSync(directory, { recursive: true, force: true })
  }
})

import 'reflect-metadata'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import handler, { closeApplication } from '../../api/index'
import { test } from 'node:test'

test('Vercel API function serves top-level and nested Nest routes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'azhar-vercel-function-'))
  const previousDatabase = process.env.AZHAR_STORE_DB
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousVercel = process.env.VERCEL
  delete process.env.DATABASE_URL
  delete process.env.VERCEL
  process.env.AZHAR_STORE_DB = join(directory, 'test.sqlite')

  const server = createServer((request, response) => {
    void handler(request, response).catch((error: unknown) => {
      response.statusCode = 500
      response.end(error instanceof Error ? error.message : 'Unknown error')
    })
  })

  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const health = await fetch(`http://127.0.0.1:${address.port}/api?__api_path=health`)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { ok: true, database: 'connected' })

    const currentUser = await fetch(`http://127.0.0.1:${address.port}/api?__api_path=auth/me`)
    assert.equal(currentUser.status, 200)
    assert.deepEqual(await currentUser.json(), { user: null })

    const paymentOptions = await fetch(`http://127.0.0.1:${address.port}/api?__api_path=payments/options`)
    assert.equal(paymentOptions.status, 200)
    assert.deepEqual(await paymentOptions.json(), { methods: ['COD'] })
  } finally {
    await closeApplication()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    if (previousDatabase === undefined) delete process.env.AZHAR_STORE_DB
    else process.env.AZHAR_STORE_DB = previousDatabase
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousVercel === undefined) delete process.env.VERCEL
    else process.env.VERCEL = previousVercel
    rmSync(directory, { recursive: true, force: true })
  }
})

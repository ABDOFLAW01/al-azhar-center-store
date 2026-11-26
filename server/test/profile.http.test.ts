import 'reflect-metadata'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { DatabaseService } from '../src/database/database.service'
import { test } from 'node:test'

test('customers can update their profile, avatar, and password securely', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'azhar-profile-test-'))
  const previousDirectory = process.cwd()
  const previousDatabase = process.env.AZHAR_STORE_DB
  const previousApiKey = process.env.CHATBOT_API_KEY
  delete process.env.CHATBOT_API_KEY
  process.env.AZHAR_STORE_DB = join(directory, 'test.sqlite')
  process.chdir(directory)

  const app = await NestFactory.create(AppModule, { logger: false })
  try {
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`

    async function request(path: string, method = 'GET', body?: unknown, cookie?: string) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      return { response, data: await response.json() as any }
    }

    const unauthenticated = await request('/api/auth/profile', 'PATCH', { name: 'Nope', accentColor: '#ffffff' })
    assert.equal(unauthenticated.response.status, 401)

    const registration = await request('/api/auth/register', 'POST', {
      name: 'Profile Customer',
      email: 'profile@example.test',
      phone: '01000000000',
      password: 'TestPass1234',
    })
    assert.equal(registration.response.status, 201)
    assert.equal(registration.data.user.font_scale, 'normal')
    const sessionCookie = registration.response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
    const userId = registration.data.user.id as string
    const database = app.get(DatabaseService)

    const profile = await request('/api/auth/profile', 'PATCH', { name: 'Updated Customer', accentColor: '#2855a0', fontScale: 'large' }, sessionCookie)
    assert.equal(profile.response.status, 200)
    assert.equal(profile.data.user.name, 'Updated Customer')
    assert.equal(profile.data.user.accent_color, '#2855a0')
    assert.equal(profile.data.user.font_scale, 'large')
    const storedProfile = database.db.prepare('SELECT name,accent_color,font_scale FROM users WHERE id=?').get(userId) as { name: string; accent_color: string; font_scale: string }
    assert.equal(storedProfile.name, 'Updated Customer')
    assert.equal(storedProfile.accent_color, '#2855a0')
    assert.equal(storedProfile.font_scale, 'large')

    const legacyProfile = await request('/api/auth/profile', 'PATCH', { name: 'Legacy Profile Client', accentColor: '#2855a0' }, sessionCookie)
    assert.equal(legacyProfile.response.status, 200)
    assert.equal(legacyProfile.data.user.font_scale, 'large')

    const invalidColor = await request('/api/auth/profile', 'PATCH', { name: 'Updated Customer', accentColor: 'red' }, sessionCookie)
    assert.equal(invalidColor.response.status, 400)
    const invalidFontScale = await request('/api/auth/profile', 'PATCH', { name: 'Updated Customer', accentColor: '#2855a0', fontScale: 'huge' }, sessionCookie)
    assert.equal(invalidFontScale.response.status, 400)

    const invalidImage = await request('/api/auth/avatar', 'POST', { dataUrl: 'data:image/png;base64,Zm9v' }, sessionCookie)
    assert.equal(invalidImage.response.status, 400)

    const pngData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2sAAAAASUVORK5CYII='
    const avatar = await request('/api/auth/avatar', 'POST', { dataUrl: `data:image/png;base64,${pngData}` }, sessionCookie)
    assert.equal(avatar.response.status, 201)
    assert.match(avatar.data.user.avatar_url, /^\/avatars\/[0-9a-f-]+\.png$/)
    const savedImage = readFileSync(join(directory, 'public', 'avatars', basename(avatar.data.user.avatar_url)))
    assert.deepEqual(savedImage.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]))

    const secondLogin = await request('/api/auth/login', 'POST', { email: 'profile@example.test', password: 'TestPass1234' })
    assert.equal(secondLogin.response.status, 201)
    const otherCookie = secondLogin.response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''

    const wrongPassword = await request('/api/auth/password', 'PATCH', { currentPassword: 'wrong', newPassword: 'NewPass12345' }, sessionCookie)
    assert.equal(wrongPassword.response.status, 401)
    const passwordChange = await request('/api/auth/password', 'PATCH', { currentPassword: 'TestPass1234', newPassword: 'NewPass12345' }, sessionCookie)
    assert.equal(passwordChange.response.status, 200)
    assert.ok((await request('/api/auth/me', 'GET', undefined, sessionCookie)).data.user)
    assert.equal((await request('/api/auth/me', 'GET', undefined, otherCookie)).data.user, null)
    assert.equal((await request('/api/auth/login', 'POST', { email: 'profile@example.test', password: 'TestPass1234' })).response.status, 401)
    assert.equal((await request('/api/auth/login', 'POST', { email: 'profile@example.test', password: 'NewPass12345' })).response.status, 201)
  } finally {
    await app.close()
    process.chdir(previousDirectory)
    if (previousDatabase === undefined) delete process.env.AZHAR_STORE_DB
    else process.env.AZHAR_STORE_DB = previousDatabase
    if (previousApiKey === undefined) delete process.env.CHATBOT_API_KEY
    else process.env.CHATBOT_API_KEY = previousApiKey
    rmSync(directory, { recursive: true, force: true })
  }
})

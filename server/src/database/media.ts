import { BadRequestException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import type { DatabaseAdapter } from './database-adapter.js'

export async function saveMedia(database: DatabaseAdapter, contentType: string, data: Uint8Array) {
  if (data.byteLength > 3 * 1024 * 1024) {
    throw new BadRequestException('حجم الصورة يجب ألا يتجاوز 3 ميجابايت')
  }
  const id = randomUUID()
  await database.prepare(`
    INSERT INTO media (id,content_type,data,created_at)
    VALUES (?,?,?,?)
  `).run(id, contentType, data, new Date().toISOString())
  return `/api/media/${id}`
}

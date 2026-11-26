import { randomUUID } from 'node:crypto'
import type { DatabaseAdapter } from './database-adapter'

export async function saveMedia(database: DatabaseAdapter, contentType: string, data: Uint8Array) {
  const id = randomUUID()
  await database.prepare(`
    INSERT INTO media (id,content_type,data,created_at)
    VALUES (?,?,?,?)
  `).run(id, contentType, data, new Date().toISOString())
  return `/api/media/${id}`
}

import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseService } from '../src/database/database.service'
import { test } from 'node:test'

test('new stores get only photo-supported product categories, not sample products', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'azhar-categories-test-'))
  const previousDatabase = process.env.AZHAR_STORE_DB
  process.env.AZHAR_STORE_DB = join(directory, 'test.sqlite')
  const database = new DatabaseService()
  try {
    await database.onModuleInit()
    const categories = database.db.prepare('SELECT name,slug,sort_order FROM categories ORDER BY sort_order').all() as Array<{
      name: string
      slug: string
      sort_order: number
    }>
    assert.deepEqual(
      categories.map((category) => [category.name, category.slug, category.sort_order]),
      [
        ['الكتب والمراجع التعليمية', 'educational-books', 10],
        ['المصاحف وكتب التجويد والقراءات', 'quran-tajweed', 20],
        ['الزي الأزهري', 'azhar-uniforms', 30],
        ['مستلزمات الصلاة', 'prayer-supplies', 40],
        ['الدفاتر والأدوات المدرسية', 'school-supplies', 50],
      ],
    )
    const productCount = database.db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }
    assert.equal(productCount.count, 0)
  } finally {
    await database.onModuleDestroy()
    if (previousDatabase === undefined) delete process.env.AZHAR_STORE_DB
    else process.env.AZHAR_STORE_DB = previousDatabase
    rmSync(directory, { recursive: true, force: true })
  }
})

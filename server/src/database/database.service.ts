import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { PostgresAdapter, SQLiteAdapter, type DatabaseAdapter } from './database-adapter'
import { defaultStoreSettings } from './store-defaults'

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly db: DatabaseAdapter
  private readonly postgres: PostgresAdapter | null

  constructor() {
    const connectionString = process.env.DATABASE_URL?.trim()
    if (connectionString) {
      this.postgres = new PostgresAdapter(connectionString)
      this.db = this.postgres
      return
    }
    if (process.env.VERCEL) {
      throw new Error('DATABASE_URL must be configured for the Vercel deployment')
    }
    this.postgres = null
    const databasePath = resolve(process.env.AZHAR_STORE_DB ?? '.data/al-azhar-store.sqlite')
    mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new SQLiteAdapter(new DatabaseSync(databasePath))
  }

  async onModuleInit() {
    if (this.postgres) {
      await this.postgres.initialize()
      await this.seedPostgres()
      return
    }
    await this.initializeSqlite()
  }

  private async initializeSqlite() {
    const db = this.db
    await db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        phone TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','ADMIN')),
        account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','DISABLED')),
        last_seen_at TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        accent_color TEXT NOT NULL DEFAULT '#1f5d3a',
        font_scale TEXT NOT NULL DEFAULT 'normal' CHECK (font_scale IN ('small','normal','large','xlarge')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL DEFAULT ''
      ) STRICT;

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL REFERENCES categories(id),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL CHECK (price >= 0),
        old_price INTEGER,
        stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        image_url TEXT NOT NULL DEFAULT '',
        is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        city TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        subtotal INTEGER NOT NULL,
        shipping INTEGER NOT NULL,
        total INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING','CONFIRMED','SHIPPED','DELIVERED','CANCELLED')),
        payment_method TEXT NOT NULL DEFAULT 'COD',
        payment_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
        payment_reference TEXT NOT NULL DEFAULT '',
        payment_transaction_id TEXT NOT NULL DEFAULT '',
        payment_expires_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price INTEGER NOT NULL CHECK (unit_price >= 0)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS store_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        content_type TEXT NOT NULL,
        data BLOB NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS site_content (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('IMAGE','SECTION')),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1)),
        created_at TEXT NOT NULL
      ) STRICT;
    `)
    const userColumns = await db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
    if (!userColumns.some((column) => column.name === 'account_status')) {
      await db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','DISABLED'))")
    }
    if (!userColumns.some((column) => column.name === 'last_seen_at')) {
      await db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''")
    }
    if (!userColumns.some((column) => column.name === 'avatar_url')) {
      await db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''")
    }
    if (!userColumns.some((column) => column.name === 'accent_color')) {
      await db.exec("ALTER TABLE users ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#1f5d3a'")
    }
    if (!userColumns.some((column) => column.name === 'font_scale')) {
      await db.exec("ALTER TABLE users ADD COLUMN font_scale TEXT NOT NULL DEFAULT 'normal' CHECK (font_scale IN ('small','normal','large','xlarge'))")
    }
    const sessionColumns = await db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
    if (!sessionColumns.some((column) => column.name === 'last_seen_at')) {
      await db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''")
    }
    const productColumns = await db.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>
    const existingColumns = new Set(productColumns.map((column) => column.name))
    if (!existingColumns.has('sku')) await db.exec("ALTER TABLE products ADD COLUMN sku TEXT NOT NULL DEFAULT ''")
    if (!existingColumns.has('barcode')) await db.exec("ALTER TABLE products ADD COLUMN barcode TEXT NOT NULL DEFAULT ''")
    if (!existingColumns.has('brand')) await db.exec("ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT ''")
    if (!existingColumns.has('unit')) await db.exec("ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'قطعة'")
    const orderColumns = new Set((await db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map((column) => column.name))
    if (!orderColumns.has('customer_email')) await db.exec("ALTER TABLE orders ADD COLUMN customer_email TEXT NOT NULL DEFAULT ''")
    if (!orderColumns.has('payment_status')) await db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED'")
    if (!orderColumns.has('payment_reference')) await db.exec("ALTER TABLE orders ADD COLUMN payment_reference TEXT NOT NULL DEFAULT ''")
    if (!orderColumns.has('payment_transaction_id')) await db.exec("ALTER TABLE orders ADD COLUMN payment_transaction_id TEXT NOT NULL DEFAULT ''")
    if (!orderColumns.has('payment_expires_at')) await db.exec("ALTER TABLE orders ADD COLUMN payment_expires_at TEXT NOT NULL DEFAULT ''")

    const defaults = defaultStoreSettings
    const insertSetting = db.prepare('INSERT OR IGNORE INTO store_settings (key,value) VALUES (?,?)')
    for (const [key, value] of Object.entries(defaults)) await insertSetting.run(key, value)
    await db.prepare("UPDATE store_settings SET value=? WHERE key='store_facebook' AND value='https://www.facebook.com/AlAzhar.Center.eg'")
      .run(defaults.store_facebook)
    await this.seed()
    await this.seedSiteContent()
  }

  private async seedSiteContent() {
    const defaults = [
      ['about-photo-1','IMAGE','مكتبة المركز','/about-gallery/library-shelves.png',10],
      ['about-photo-2','IMAGE','كتاب تعليمي','/about-gallery/educational-book.png',20],
      ['about-photo-3','IMAGE','كتاب إسلامي','/about-gallery/islamic-book.png',30],
      ['about-photo-4','IMAGE','سبح','/about-gallery/tasbeeh.png',40],
      ['about-photo-5','IMAGE','مستلزمات متنوعة','/about-gallery/prayer-accessory.png',50],
      ['about-photo-6','IMAGE','زي أزهري','/about-gallery/azhar-clothing.png',60],
    ] as const
    const getSetting = this.db.prepare('SELECT value FROM store_settings WHERE key=?')
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO site_content (id,kind,title,description,image_url,sort_order,is_visible,created_at)
      VALUES (?,?,?,'',?,?,1,?)
    `)
    for (let index = 0; index < defaults.length; index += 1) {
      const [id,kind,title,imageUrl,sortOrder] = defaults[index]
      const legacyCaption = await getSetting.get(`about_gallery_${index + 1}_caption`) as { value: string } | undefined
      const legacyImage = await getSetting.get(`about_gallery_${index + 1}_image`) as { value: string } | undefined
      await insert.run(id,kind,legacyCaption?.value || title,legacyImage?.value || imageUrl,sortOrder,new Date().toISOString())
    }
  }

  private async seed() {
    const categories = [
      ['category-educational-books', 'الكتب والمراجع التعليمية', 'educational-books', 10],
      ['category-quran-tajweed', 'المصاحف وكتب التجويد والقراءات', 'quran-tajweed', 20],
      ['category-azhar-uniforms', 'الزي الأزهري', 'azhar-uniforms', 30],
      ['category-prayer-supplies', 'مستلزمات الصلاة', 'prayer-supplies', 40],
      ['category-school-supplies', 'الدفاتر والأدوات المدرسية', 'school-supplies', 50],
    ] as const
    const insertCategory = this.db.prepare(
      'INSERT OR IGNORE INTO categories (id,name,slug,sort_order) VALUES (?,?,?,?)',
    )
    for (const category of categories) await insertCategory.run(...category)
  }

  private async seedPostgres() {
    const insertSetting = this.db.prepare('INSERT OR IGNORE INTO store_settings (key,value) VALUES (?,?)')
    for (const [key, value] of Object.entries(defaultStoreSettings)) await insertSetting.run(key, value)
    await this.seed()
    await this.seedSiteContent()
  }

  async onModuleDestroy() {
    await this.db.close()
  }
}

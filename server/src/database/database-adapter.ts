import { AsyncLocalStorage } from 'node:async_hooks'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { Pool, type PoolClient, type QueryResultRow } from 'pg'

export type MaybePromise<T> = T | Promise<T>

export interface DatabaseStatement {
  all(...values: SQLInputValue[]): MaybePromise<QueryResultRow[]>
  get(...values: SQLInputValue[]): MaybePromise<QueryResultRow | undefined>
  run(...values: SQLInputValue[]): MaybePromise<{ changes: number }>
}

export interface DatabaseAdapter {
  prepare(sql: string): DatabaseStatement
  exec(sql: string): MaybePromise<void>
  transaction<T>(callback: () => Promise<T>): Promise<T>
  close(): MaybePromise<void>
}

export class SQLiteAdapter implements DatabaseAdapter {
  private readonly transactionContext = new AsyncLocalStorage<boolean>()
  private transactionTail: Promise<void> = Promise.resolve()
  private transactionActive = false
  private readonly blockedOperations: Array<() => void> = []

  constructor(private readonly database: DatabaseSync) {}

  prepare(sql: string): DatabaseStatement {
    const statement = this.database.prepare(sql)
    return {
      all: (...values) => this.execute(() => statement.all(...values) as QueryResultRow[]),
      get: (...values) => this.execute(() => statement.get(...values) as QueryResultRow | undefined),
      run: (...values) => {
        return this.execute(() => {
          const result = statement.run(...values)
          return { changes: Number(result.changes) }
        })
      },
    }
  }

  exec(sql: string): MaybePromise<void> {
    return this.execute(() => this.database.exec(sql))
  }

  async transaction<T>(callback: () => Promise<T>) {
    if (this.transactionContext.getStore()) return callback()

    const previousTransaction = this.transactionTail
    let releaseTransaction!: () => void
    this.transactionTail = new Promise<void>((resolve) => { releaseTransaction = resolve })
    await previousTransaction
    this.transactionActive = true
    try {
      this.database.exec('BEGIN IMMEDIATE')
      const result = await this.transactionContext.run(true, callback)
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    } finally {
      this.transactionActive = false
      releaseTransaction()
      for (const unblock of this.blockedOperations.splice(0)) unblock()
    }
  }

  close() {
    this.database.close()
  }

  private execute<T>(operation: () => T): MaybePromise<T> {
    if (!this.transactionActive || this.transactionContext.getStore()) return operation()
    return new Promise<T>((resolve, reject) => {
      this.blockedOperations.push(() => {
        try {
          resolve(operation())
        } catch (error) {
          reject(error)
        }
      })
    })
  }
}

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','ADMIN')),
    account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','DISABLED')),
    last_seen_at TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    accent_color TEXT NOT NULL DEFAULT '#1f5d3a',
    font_scale TEXT NOT NULL DEFAULT 'normal' CHECK (font_scale IN ('small','normal','large','xlarge')),
    created_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
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
    sku TEXT NOT NULL DEFAULT '',
    barcode TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'قطعة',
    created_at TEXT NOT NULL
  );
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
  );
  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0)
  );
  CREATE TABLE IF NOT EXISTS store_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    content_type TEXT NOT NULL,
    data BYTEA NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS site_content (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('IMAGE','SECTION')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1)),
    created_at TEXT NOT NULL
  );
`

function postgresSql(sql: string) {
  let converted = sql
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(converted)) {
    converted = converted.replace(/^\s*INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO').trimEnd()
    converted += ' ON CONFLICT DO NOTHING'
  } else if (/^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+store_settings/i.test(converted)) {
    converted = converted.replace(/^\s*INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO').trimEnd()
    converted += ' ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value'
  }

  let index = 0
  let quote: "'" | '"' | '`' | null = null
  let result = ''
  for (let cursor = 0; cursor < converted.length; cursor += 1) {
    const character = converted[cursor]
    if (quote) {
      result += character
      if (character === quote) {
        if (converted[cursor + 1] === quote) result += converted[++cursor]
        else quote = null
      } else if (character === '\\' && quote !== '`' && cursor + 1 < converted.length) {
        result += converted[++cursor]
      }
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      result += character
    } else if (character === '?') {
      result += `$${++index}`
    } else {
      result += character
    }
  }
  return result
}

export class PostgresAdapter implements DatabaseAdapter {
  private readonly pool: Pool
  private readonly activeTransaction = new AsyncLocalStorage<PoolClient>()

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: process.env.VERCEL ? 1 : 5,
      idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
    })
  }

  async initialize() {
    await this.pool.query(postgresSchema)
    await this.pool.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS account_status TEXT NOT NULL DEFAULT 'ACTIVE';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT '#1f5d3a';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS font_scale TEXT NOT NULL DEFAULT 'normal';
      ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS sku TEXT NOT NULL DEFAULT '';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT NOT NULL DEFAULT '';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT '';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS unit TEXT NOT NOT NULL DEFAULT 'قطعة';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_reference TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_transaction_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_expires_at TEXT NOT NULL DEFAULT '';
    `)
    await this.pool.query("INSERT INTO store_settings (key,value) VALUES ('site_accent_color','#1f5d3a') ON CONFLICT (key) DO NOTHING")
  }

  prepare(sql: string): DatabaseStatement {
    const query = postgresSql(sql)
    return {
      all: async (...values) => (await this.query(query, values)).rows,
      get: async (...values) => (await this.query(query, values)).rows[0],
      run: async (...values) => {
        const result = await this.query(query, values)
        return { changes: result.rowCount ?? 0 }
      },
    }
  }

  async exec(sql: string) {
    await this.query(postgresSql(sql), [])
  }

  async transaction<T>(callback: () => Promise<T>) {
    const active = this.activeTransaction.getStore()
    if (active) return callback()

    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await this.activeTransaction.run(client, callback)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close() {
    await this.pool.end()
  }

  private query(sql: string, values: unknown[]) {
    const client = this.activeTransaction.getStore()
    return client
      ? client.query(sql, values)
      : this.pool.query(sql, values)
  }
}

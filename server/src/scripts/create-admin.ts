import 'reflect-metadata'
import { randomBytes, scryptSync, randomUUID } from 'node:crypto'
import { stdin, stdout } from 'node:process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { DatabaseService } from '../database/database.service.js'

if (existsSync('.env')) process.loadEnvFile()

const rl = createInterface({ input: stdin, output: stdout })
const ask = (question: string) => new Promise<string>((resolveAnswer) => rl.question(question, resolveAnswer))

async function main() {
  const name = (await ask('اسم مدير المتجر: ')).trim()
  const email = (await ask('البريد الإداري: ')).trim().toLowerCase()
  const phone = (await ask('رقم الهاتف: ')).trim()
  const password = await ask('كلمة مرور قوية: ')
  rl.close()
  if (!name || !email || !phone || password.length < 10) {
    throw new Error('يرجى إدخال الاسم والبريد والهاتف وكلمة مرور لا تقل عن 10 أحرف')
  }
  const database = new DatabaseService()
  try {
    await database.onModuleInit()
    const existing = await database.db.prepare('SELECT id FROM users WHERE email=?').get(email) as { id: string } | undefined
    if (existing) {
      await database.db.prepare("UPDATE users SET role='ADMIN',name=?,phone=? WHERE id=?").run(name,phone,existing.id)
    } else {
      const salt = randomBytes(16).toString('hex')
      const digest = scryptSync(password, salt, 64).toString('hex')
      await database.db.prepare(`
        INSERT INTO users (id,name,email,phone,password_hash,role,created_at)
        VALUES (?,?,?,?,?,'ADMIN',?)
      `).run(randomUUID(), name, email, phone, `${salt}:${digest}`, new Date().toISOString())
    }
  } finally {
    await database.onModuleDestroy()
  }
  console.log('تم إعداد حساب المدير بنجاح.')
}

void main()

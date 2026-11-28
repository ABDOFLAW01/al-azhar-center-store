import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common'
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { DatabaseService } from '../database/database.service.js'

@Injectable()
export class AuthService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private hashPassword(password: string) {
    const salt = randomBytes(16).toString('hex')
    const digest = scryptSync(password, salt, 64).toString('hex')
    return `${salt}:${digest}`
  }

  private verifyPassword(password: string, stored: string) {
    const [salt, digest] = stored.split(':')
    if (!salt || !digest) return false
    const actual = scryptSync(password, salt, 64)
    const expected = Buffer.from(digest, 'hex')
    return expected.length === actual.length && timingSafeEqual(actual, expected)
  }

  async register(name: string, email: string, phone: string, password: string) {
    if (password.length < 8) throw new BadRequestException('كلمة المرور يجب ألا تقل عن 8 أحرف')
    const existing = await this.database.db.prepare('SELECT id FROM users WHERE email=?').get(email.trim().toLowerCase())
    if (existing) throw new BadRequestException('البريد الإلكتروني مسجل بالفعل')
    const id = randomUUID()
    const role = 'CUSTOMER'
    await this.database.db.prepare(`
      INSERT INTO users (id,name,email,phone,password_hash,role,created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(id, name.trim(), email.trim().toLowerCase(), phone.trim(), this.hashPassword(password), role, new Date().toISOString())
    return this.createSession(id)
  }

  async login(email: string, password: string) {
    const user = await this.database.db.prepare('SELECT * FROM users WHERE email=?').get(email.trim().toLowerCase()) as any
    if (!user || !this.verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedException('البريد الإلكتروني أو كلمة المرور غير صحيحة')
    }
    if (user.account_status !== 'ACTIVE') {
      throw new UnauthorizedException('هذا الحساب معطل. تواصل مع إدارة المتجر.')
    }
    return this.createSession(user.id)
  }

  async createSession(userId: string) {
    const token = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const now = new Date().toISOString()
    await this.database.db.prepare(`
      INSERT INTO sessions (token_hash,user_id,expires_at,created_at,last_seen_at)
      VALUES (?,?,?,?,?)
    `).run(tokenHash, userId, expires, now, now)
    await this.touchPresence(userId, token, now)
    const user = await this.database.db.prepare('SELECT id,name,email,phone,role,avatar_url,accent_color,font_scale,created_at FROM users WHERE id=?').get(userId)
    return { token, user }
  }

  async touchPresence(userId: string, token: string, lastSeenAt = new Date().toISOString()) {
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const now = new Date().toISOString()
    const session = await this.database.db.prepare(`
      UPDATE sessions SET last_seen_at=?
      WHERE token_hash=? AND user_id=? AND expires_at>?
    `).run(lastSeenAt, tokenHash, userId, now)
    if (session.changes !== 1) throw new UnauthorizedException('سجل الدخول أولاً')
    await this.database.db.prepare('UPDATE users SET last_seen_at=? WHERE id=?').run(lastSeenAt, userId)
  }

  async updateProfile(userId: string, name: string, accentColor: string, fontScale: string) {
    const normalizedName = name.trim()
    if (normalizedName.length < 2 || normalizedName.length > 80) {
      throw new BadRequestException('الاسم يجب أن يكون بين حرفين و80 حرفاً')
    }
    if (!/^#[0-9a-f]{6}$/i.test(accentColor)) {
      throw new BadRequestException('لون الموقع غير صالح')
    }
    if (!['small', 'normal', 'large', 'xlarge'].includes(fontScale)) {
      throw new BadRequestException('حجم الخط غير صالح')
    }
    await this.database.db.prepare('UPDATE users SET name=?,accent_color=?,font_scale=? WHERE id=?')
      .run(normalizedName, accentColor.toLowerCase(), fontScale, userId)
    return this.database.db.prepare('SELECT id,name,email,phone,role,avatar_url,accent_color,font_scale,created_at FROM users WHERE id=?').get(userId)
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    await this.database.db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(avatarUrl, userId)
    return this.database.db.prepare('SELECT id,name,email,phone,role,avatar_url,accent_color,font_scale,created_at FROM users WHERE id=?').get(userId)
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string, currentSessionToken: string) {
    if (newPassword.length < 8) throw new BadRequestException('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف')
    if (currentPassword === newPassword) throw new BadRequestException('اختر كلمة مرور مختلفة عن الحالية')
    const account = await this.database.db.prepare('SELECT password_hash FROM users WHERE id=?').get(userId) as { password_hash: string } | undefined
    if (!account || !this.verifyPassword(currentPassword, account.password_hash)) {
      throw new UnauthorizedException('كلمة المرور الحالية غير صحيحة')
    }

    const tokenHash = createHash('sha256').update(currentSessionToken).digest('hex')
    await this.database.db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(this.hashPassword(newPassword), userId)
    await this.database.db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(userId, tokenHash)
  }

  async getUser(token?: string) {
    if (!token) return null
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const row = await this.database.db.prepare(`
      SELECT u.id,u.name,u.email,u.phone,u.role,u.avatar_url,u.accent_color,u.font_scale,u.account_status,u.created_at
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.account_status='ACTIVE'
    `).get(tokenHash, new Date().toISOString()) as any
    return row ?? null
  }

  async logout(token?: string) {
    if (!token) return
    const tokenHash = createHash('sha256').update(token).digest('hex')
    await this.database.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash)
  }
}

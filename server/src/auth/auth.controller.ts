import { BadRequestException, Body, Controller, Get, Inject, Patch, Post, Req, Res, UnauthorizedException } from '@nestjs/common'
import type { Request, Response } from 'express'
import { saveMedia } from '../database/media.js'
import { DatabaseService } from '../database/database.service.js'
import { AuthService } from './auth.service.js'

function tokenFromRequest(request: Request) {
  const cookie = request.headers.cookie ?? ''
  return cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith('azhar_session='))?.slice(14)
}

function sessionCookieOptions(includeMaxAge = true) {
  const crossSite = process.env.NODE_ENV === 'production'
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' as const : 'lax' as const,
    secure: crossSite,
    ...(includeMaxAge ? { maxAge: 30 * 24 * 60 * 60 * 1000 } : {}),
  }
}

@Controller('api/auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  private async requireUser(request: Request) {
    const user = await this.auth.getUser(tokenFromRequest(request))
    if (!user) throw new UnauthorizedException('سجل الدخول أولاً')
    return user
  }

  @Post('register')
  async register(@Body() body: { name: string; email: string; phone: string; password: string }, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(body.name, body.email, body.phone, body.password)
    res.cookie('azhar_session', result.token, sessionCookieOptions())
    return { user: result.user }
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(body.email, body.password)
    res.cookie('azhar_session', result.token, sessionCookieOptions())
    return { user: result.user }
  }

  @Get('me')
  async me(@Req() req: Request) {
    return { user: await this.auth.getUser(tokenFromRequest(req)) }
  }

  @Post('presence')
  async presence(@Req() req: Request) {
    const user = await this.requireUser(req)
    const token = tokenFromRequest(req)
    if (!token) throw new UnauthorizedException('سجل الدخول أولاً')
    await this.auth.touchPresence(user.id, token)
    return { ok: true }
  }

  @Patch('profile')
  async updateProfile(@Req() req: Request, @Body() body: { name?: unknown; accentColor?: unknown; fontScale?: unknown }) {
    const user = await this.requireUser(req)
    if (typeof body.name !== 'string' || typeof body.accentColor !== 'string') {
      throw new BadRequestException('الاسم واللون مطلوبان')
    }
    const fontScale = body.fontScale === undefined ? user.font_scale : body.fontScale
    if (typeof fontScale !== 'string') throw new BadRequestException('حجم الخط غير صالح')
    return { user: await this.auth.updateProfile(user.id, body.name, body.accentColor, fontScale) }
  }

  @Patch('password')
  async changePassword(@Req() req: Request, @Body() body: { currentPassword?: unknown; newPassword?: unknown }) {
    const user = await this.requireUser(req)
    const token = tokenFromRequest(req)
    if (typeof body.currentPassword !== 'string' || typeof body.newPassword !== 'string' || !token) {
      throw new BadRequestException('أدخل كلمة المرور الحالية والجديدة')
    }
    await this.auth.changePassword(user.id, body.currentPassword, body.newPassword, token)
    return { ok: true }
  }

  @Post('avatar')
  async uploadAvatar(@Req() req: Request, @Body() body: { dataUrl?: unknown }) {
    const user = await this.requireUser(req)
    if (typeof body.dataUrl !== 'string') throw new BadRequestException('اختر صورة صالحة')
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(body.dataUrl)
    if (!match) throw new BadRequestException('صيغة الصورة يجب أن تكون PNG أو JPG أو WebP')

    const imageBytes = Buffer.from(match[2], 'base64')
    if (!imageBytes.length || imageBytes.length > 1024 * 1024) {
      throw new BadRequestException('حجم الصورة يجب ألا يتجاوز 1 ميجابايت')
    }
    const mime = `image/${match[1]}`
    const isPng = mime === 'image/png' && imageBytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    const isJpeg = mime === 'image/jpeg' && imageBytes[0] === 0xff && imageBytes[1] === 0xd8 && imageBytes[2] === 0xff
    const isWebp = mime === 'image/webp' && imageBytes.toString('ascii', 0, 4) === 'RIFF' && imageBytes.toString('ascii', 8, 12) === 'WEBP'
    if (!isPng && !isJpeg && !isWebp) throw new BadRequestException('محتوى الصورة غير صالح')

    const updatedUser = await this.auth.updateAvatar(user.id, await saveMedia(this.database.db, mime, imageBytes))
    return { user: updatedUser }
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(tokenFromRequest(req))
    res.clearCookie('azhar_session', sessionCookieOptions(false))
    return { ok: true }
  }
}

import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { resolve } from 'node:path'
import { AppModule } from './app.module.js'

export async function createApplication() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })
  app.useBodyParser('json', { limit: '4.4mb' })
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
  app.useStaticAssets(resolve(process.cwd(), 'public'), { index: false })
  const allowedOrigins = [
    'capacitor://localhost',
    'https://localhost',
    'tauri://localhost',
    'http://tauri.localhost',
    'http://localhost:4173',
    'http://127.0.0.1:4173',
    ...(process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
  ]
  app.enableCors({ origin: allowedOrigins, credentials: true })
  return app
}
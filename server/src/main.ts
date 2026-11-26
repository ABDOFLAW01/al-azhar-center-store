import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { AppModule } from './app.module'

async function bootstrap() {
  if (existsSync('.env')) process.loadEnvFile()
  console.log(`Chatbot ${process.env.CHATBOT_API_KEY ? 'enabled' : 'disabled'}; model=${process.env.CHATBOT_MODEL ?? 'gemini-3.8-flash'}`)
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false })
  app.useBodyParser('json', { limit: '8mb' })
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
  const port = Number(process.env.PORT ?? 3001)
  const host = process.env.HOST ?? '127.0.0.1'
  await app.listen(port, host)
  console.log(`Al Azhar Store API listening on http://${host}:${port}`)
}

void bootstrap()

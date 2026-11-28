import 'reflect-metadata'
import { existsSync } from 'node:fs'
import { createApplication } from './create-application'

async function bootstrap() {
  if (existsSync('.env')) process.loadEnvFile()
  console.log(`Chatbot ${process.env.CHATBOT_API_KEY ? 'enabled' : 'disabled'}; model=${process.env.CHATBOT_MODEL ?? 'gemini-3.8-flash'}`)
  const app = await createApplication()
  const port = Number(process.env.PORT ?? 3001)
  const host = process.env.HOST ?? '127.0.0.1'
  await app.listen(port, host)
  console.log(`Al Azhar Store API listening on http://${host}:${port}`)
}

void bootstrap()

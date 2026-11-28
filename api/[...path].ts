import 'reflect-metadata'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createApplication } from '../server/src/create-application.js'

let application: Promise<NestExpressApplication> | undefined

function getApplication() {
  if (!application) {
    application = createApplication().then(async (app) => {
      await app.init()
      return app
    }).catch((error) => {
      application = undefined
      throw error
    })
  }
  return application
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const app = await getApplication()
  const expressHandler = app.getHttpAdapter().getInstance()
  expressHandler(request, response)
}

export async function closeApplication() {
  if (!application) return
  const app = await application
  application = undefined
  await app.close()
}
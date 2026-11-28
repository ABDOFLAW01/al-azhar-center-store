import 'reflect-metadata'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { createApplication } from '../server/dist/server/src/create-application.js'

const apiPathParameter = '__api_path'
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

function restoreApiPath(requestUrl: string | undefined) {
  if (!requestUrl) return requestUrl
  const url = new URL(requestUrl, 'http://localhost')
  const path = url.searchParams.get(apiPathParameter)
  if (path === null) return requestUrl

  url.searchParams.delete(apiPathParameter)
  url.pathname = `/api/${path}`
  return `${url.pathname}${url.search}`
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  const app = await getApplication()
  const expressHandler = app.getHttpAdapter().getInstance()
  request.url = restoreApiPath(request.url)
  expressHandler(request, response)
}

export async function closeApplication() {
  if (!application) return
  const app = await application
  application = undefined
  await app.close()
}

import { BadGatewayException, BadRequestException, Body, Controller, Inject, Post, ServiceUnavailableException } from '@nestjs/common'
import { DatabaseService } from './database/database.service'

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>
}

function retryDelay(response: Response, attempt: number) {
  const maximumDelay = 8000
  const retryAfter = response.headers.get('retry-after')
  const seconds = retryAfter ? Number(retryAfter) : Number.NaN
  const requestedDelay = Number.isFinite(seconds)
    ? seconds * 1000
    : retryAfter
      ? Date.parse(retryAfter) - Date.now()
      : Number.NaN
  const baseDelay = Number.isFinite(requestedDelay)
    ? Math.min(maximumDelay, Math.max(0, requestedDelay))
    : Math.min(maximumDelay, 1000 * (2 ** attempt))
  return baseDelay === 0 ? 0 : Math.round(baseDelay * (0.8 + Math.random() * 0.4))
}

function connectionErrorCode(error: unknown) {
  if (typeof error !== 'object' || error === null) return ''
  if ('code' in error && typeof error.code === 'string') return error.code
  if (!('cause' in error) || typeof error.cause !== 'object' || error.cause === null || !('code' in error.cause)) return ''
  return typeof error.cause.code === 'string' ? error.cause.code : ''
}

function logConnectionFailure(error: unknown, apiKey: string) {
  const detail = error instanceof Error
    ? error.message.replaceAll(apiKey, '[redacted]').replace(/\s+/g, ' ').slice(0, 200)
    : 'Unknown network error'
  const code = connectionErrorCode(error)
  console.error(`[Chatbot] Provider connection failed${code ? ` (${code})` : ''}: ${detail}`)
}

@Controller('api/chatbot')
export class ChatbotController {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  @Post('message')
  async message(@Body() body: { message?: string }) {
    const message = String(body.message ?? '').trim()
    if (!message) throw new BadRequestException('اكتب رسالة أولاً')
    if (message.length > 2000) throw new BadRequestException('الرسالة طويلة جداً')

    const apiKey = process.env.CHATBOT_API_KEY
    if (!apiKey) {
      throw new ServiceUnavailableException('المساعد الذكي غير مفعّل بعد. أضف مفتاح مزوّد الذكاء الاصطناعي إلى إعدادات الخادم.')
    }

    const apiUrl = process.env.CHATBOT_API_URL
      ?? 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
    const model = process.env.CHATBOT_MODEL ?? 'gemini-3.8-flash'
    const products = this.database.db.prepare(`
      SELECT p.name,p.description,p.price,p.stock,p.unit,c.name AS category
      FROM products p JOIN categories c ON c.id=p.category_id
      WHERE p.is_active=1
      ORDER BY p.is_featured DESC,p.name
      LIMIT 100
    `).all()

    const requestCompletion = () => fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content: [
              'You are the customer support assistant for Al Azhar Center store in Shibin El Qanater, Egypt.',
              'Reply in the same language as the customer (Arabic or English), clearly and briefly.',
              'Use the provided current catalog as the only source for product names, prices, and stock. Never invent or guess product details, prices, delivery promises, or policies.',
              'If requested information is not present, say it is not currently available and suggest contacting the store.',
              'The store currently accepts cash on delivery. Do not claim that you can look up an order unless its details are included in this conversation.',
              `Current live product catalog (JSON): ${JSON.stringify(products)}`,
            ].join('\n'),
          },
          { role: 'user', content: message },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    })

    let response: Response | undefined
    const maxAttempts = 4
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const attemptResponse = await requestCompletion()
        const retryableStatuses = [408, 429, 502, 503, 504]
        if (attempt < maxAttempts - 1 && retryableStatuses.includes(attemptResponse.status)) {
          const delay = retryDelay(attemptResponse, attempt)
          await attemptResponse.body?.cancel()
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        response = attemptResponse
        break
      } catch (error) {
        const retryableCodes = ['ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT']
        const code = connectionErrorCode(error)
        const isTimeout = error instanceof Error && error.name === 'TimeoutError'
        if (attempt < maxAttempts - 1 && (retryableCodes.includes(code) || isTimeout)) {
          logConnectionFailure(error, apiKey)
          const baseDelay = Math.min(8000, 500 * (2 ** attempt))
          const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4))
          await new Promise((resolve) => setTimeout(resolve, delay))
          continue
        }
        logConnectionFailure(error, apiKey)
        if (isTimeout) {
          throw new ServiceUnavailableException('استغرق رد المساعد وقتاً أطول من المتوقع. جرّب مرة أخرى بعد قليل.')
        }
        throw new ServiceUnavailableException('تعذر الاتصال بمزوّد المساعد الذكي. حاول مرة أخرى لاحقاً.')
      }
    }
    if (!response) throw new ServiceUnavailableException('تعذر الاتصال بمزوّد المساعد الذكي. حاول مرة أخرى لاحقاً.')

    if (!response.ok) {
      const providerErrorBody = await response.text()
      let providerMessage = ''
      try {
        const providerError = JSON.parse(providerErrorBody) as { error?: { message?: unknown } }
        if (typeof providerError.error?.message === 'string') providerMessage = providerError.error.message
      } catch {
        providerMessage = ''
      }
      const safeProviderMessage = providerMessage
        .replaceAll(apiKey, '[redacted]')
        .replace(/\s+/g, ' ')
        .slice(0, 300)
      console.error(`[Chatbot] Provider returned HTTP ${response.status} for model ${model}.${safeProviderMessage ? ` ${safeProviderMessage}` : ''}`)
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        throw new BadGatewayException(`خدمة Google Gemini غير متاحة مؤقتًا (HTTP ${response.status}). جرّب إرسال الرسالة مرة أخرى بعد قليل.`)
      }
      if (response.status === 401 || response.status === 403) {
        throw new BadGatewayException('مفتاح Gemini غير صالح أو لا يملك صلاحية استخدام هذا النموذج.')
      }
      if (response.status === 404) {
        throw new BadGatewayException('رابط API أو اسم النموذج غير متاح. راجع CHATBOT_API_URL وCHATBOT_MODEL.')
      }
      if (response.status === 429) {
        throw new BadGatewayException('تم تجاوز حصة Gemini أو لم يتم تفعيل الفوترة للمفتاح.')
      }
      if (response.status === 400) {
        throw new BadGatewayException('Gemini رفض إعدادات الطلب. تحقق من اسم النموذج وإعدادات الخادم.')
      }
      throw new BadGatewayException(`مزوّد المساعد الذكي رفض الطلب (HTTP ${response.status}).`)
    }

    const result = await response.json() as ChatCompletionResponse
    const reply = result.choices?.[0]?.message?.content?.trim()
    if (!reply) throw new BadGatewayException('لم يُرجع المزوّد إجابة صالحة')
    return { reply }
  }
}

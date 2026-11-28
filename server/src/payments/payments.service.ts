import { BadGatewayException, Inject, Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { DatabaseService } from '../database/database.service.js'

type PaymobConfig = {
  apiKey: string
  integrationId: number
  iframeId: number
  hmacSecret: string
  notificationUrl: string
  returnUrl: string
}

export type PaymobTransaction = {
  amount_cents?: string | number
  created_at?: string
  currency?: string
  error_occured?: boolean | string
  has_parent_transaction?: boolean | string
  id?: string | number
  integration_id?: string | number
  is_3d_secure?: boolean | string
  is_auth?: boolean | string
  is_capture?: boolean | string
  is_refunded?: boolean | string
  is_standalone_payment?: boolean | string
  is_voided?: boolean | string
  order?: { id?: string | number; merchant_order_id?: string | number }
  owner?: string | number
  pending?: boolean | string
  source_data?: { pan?: string; sub_type?: string; type?: string }
  success?: boolean | string
}

type BillingDetails = {
  name: string
  email: string
  phone: string
  address: string
  city: string
}

type PaymobOrderItem = {
  name: string
  quantity: number
  unitPrice: number
}

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private expiryTimer: ReturnType<typeof setInterval> | undefined

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async onModuleInit() {
    await this.expirePendingPayments()
    this.expiryTimer = setInterval(() => {
      void this.expirePendingPayments().catch((error) =>
        console.error('[Payments] Could not expire abandoned checkout orders', error))
    }, 60_000)
    this.expiryTimer.unref()
  }

  onModuleDestroy() {
    if (this.expiryTimer) clearInterval(this.expiryTimer)
  }

  publicOptions() {
    return { methods: ['COD', ...(this.config() ? ['PAYMOB'] : [])] }
  }

  isPaymobConfigured() {
    return this.config() !== null
  }

  expectedIntegrationId() {
    return this.config()?.integrationId ?? null
  }

  verifyWebhook(transaction: PaymobTransaction, suppliedHmac: string) {
    const config = this.config()
    if (!config || !/^[a-f\d]{128}$/i.test(suppliedHmac)) return false
    const fields: Array<string | number | boolean | undefined> = [
      transaction.amount_cents,
      transaction.created_at,
      transaction.currency,
      transaction.error_occured,
      transaction.has_parent_transaction,
      transaction.id,
      transaction.integration_id,
      transaction.is_3d_secure,
      transaction.is_auth,
      transaction.is_capture,
      transaction.is_refunded,
      transaction.is_standalone_payment,
      transaction.is_voided,
      transaction.order?.id,
      transaction.owner,
      transaction.pending,
      transaction.source_data?.pan,
      transaction.source_data?.sub_type,
      transaction.source_data?.type,
      transaction.success,
    ]
    const expected = createHmac('sha512', config.hmacSecret)
      .update(fields.map((value) => String(value ?? '')).join(''))
      .digest()
    const supplied = Buffer.from(suppliedHmac, 'hex')
    return supplied.length === expected.length && timingSafeEqual(expected, supplied)
  }

  async createPaymobCheckout(input: {
    orderId: string
    total: number
    billing: BillingDetails
    items: PaymobOrderItem[]
  }) {
    const config = this.config()
    if (!config) throw new ServiceUnavailableException('الدفع الإلكتروني غير مفعّل؛ إعدادات Paymob المطلوبة غير مكتملة')
    const amountCents = Math.round(input.total * 100)
    const [firstName, ...otherNames] = input.billing.name.trim().split(/\s+/)
    const lastName = otherNames.join(' ') || firstName
    const billingData = {
      apartment: 'NA',
      email: input.billing.email,
      floor: 'NA',
      first_name: firstName,
      street: input.billing.address,
      building: 'NA',
      phone_number: input.billing.phone,
      shipping_method: 'NA',
      postal_code: 'NA',
      city: input.billing.city,
      country: 'EG',
      last_name: lastName,
      state: input.billing.city,
    }

    const auth = await this.post<{ token?: string }>('/auth/tokens', { api_key: config.apiKey })
    if (!auth.token) throw new BadGatewayException('لم يُرجع Paymob رمز جلسة صالحًا')

    const remoteOrder = await this.post<{ id?: number | string }>('/ecommerce/orders', {
      auth_token: auth.token,
      delivery_needed: false,
      amount_cents: amountCents,
      currency: 'EGP',
      merchant_order_id: input.orderId,
      items: input.items.map((item) => ({
        name: item.name,
        amount_cents: Math.round(item.unitPrice * 100),
        description: item.name,
        quantity: item.quantity,
      })),
    })
    if (remoteOrder.id == null) throw new BadGatewayException('لم يُرجع Paymob رقم الطلب الإلكتروني')

    const paymentKey = await this.post<{ token?: string }>('/acceptance/payment_keys', {
      auth_token: auth.token,
      amount_cents: amountCents,
      expiration: 3600,
      order_id: remoteOrder.id,
      billing_data: billingData,
      currency: 'EGP',
      integration_id: config.integrationId,
      lock_order_when_paid: true,
      notification_url: config.notificationUrl,
      redirection_url: this.returnUrl(config.returnUrl, input.orderId),
    })
    if (!paymentKey.token) throw new BadGatewayException('لم يُرجع Paymob رابط الدفع')

    return {
      paymentReference: String(remoteOrder.id),
      paymentExpiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      checkoutUrl: `https://accept.paymob.com/api/acceptance/iframes/${config.iframeId}?payment_token=${encodeURIComponent(paymentKey.token)}`,
    }
  }

  async expirePendingPayments() {
    const expired = await this.database.db.prepare(`
      SELECT id FROM orders
      WHERE payment_method='PAYMOB' AND payment_status='PENDING'
        AND payment_expires_at<>'' AND payment_expires_at<=?
    `).all(new Date().toISOString()) as Array<{ id: string }>
    for (const { id } of expired) {
      await this.database.db.transaction(async () => {
        const order = await this.database.db.prepare(`
          UPDATE orders SET payment_status=payment_status
          WHERE id=? AND payment_method='PAYMOB' AND payment_status='PENDING'
        `).run(id)
        if (order.changes === 0) return
        const items = await this.database.db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(id) as Array<{ product_id: string | null; quantity: number }>
        for (const item of items) {
          if (item.product_id) await this.database.db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(item.quantity, item.product_id)
        }
        await this.database.db.prepare(`
          UPDATE orders SET payment_status='EXPIRED',status='CANCELLED'
          WHERE id=? AND payment_status='PENDING'
        `).run(id)
      })
    }
  }

  private config(): PaymobConfig | null {
    const apiKey = process.env.PAYMOB_API_KEY?.trim()
    const integrationId = Number(process.env.PAYMOB_INTEGRATION_ID)
    const iframeId = Number(process.env.PAYMOB_IFRAME_ID)
    const hmacSecret = process.env.PAYMOB_HMAC_SECRET?.trim()
    const notificationUrl = process.env.PAYMOB_NOTIFICATION_URL?.trim()
    const returnUrl = process.env.PAYMOB_RETURN_URL?.trim()
    if (!apiKey || !Number.isSafeInteger(integrationId) || integrationId < 1 ||
        !Number.isSafeInteger(iframeId) || iframeId < 1 || !hmacSecret ||
        !this.isPublicHttpsUrl(notificationUrl) || !this.isPublicHttpsUrl(returnUrl)) return null
    return { apiKey, integrationId, iframeId, hmacSecret, notificationUrl, returnUrl }
  }

  private isPublicHttpsUrl(value: string | undefined): value is string {
    if (!value) return false
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
    } catch {
      return false
    }
  }

  private returnUrl(baseUrl: string, orderId: string) {
    const url = new URL(baseUrl)
    url.searchParams.set('order_ref', orderId)
    return url.toString()
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    let response: Response
    try {
      response = await fetch(`https://accept.paymob.com/api${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      throw new ServiceUnavailableException('تعذر الاتصال بمزوّد الدفع؛ لم يتم إنشاء الطلب')
    }
    if (!response.ok) {
      throw new BadGatewayException(`تعذر إنشاء جلسة الدفع لدى Paymob (HTTP ${response.status})`)
    }
    try {
      return await response.json() as T
    } catch {
      throw new BadGatewayException('استجابة Paymob غير صالحة')
    }
  }
}

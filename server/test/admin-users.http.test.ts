import 'reflect-metadata'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createHmac, scryptSync } from 'node:crypto'
import { NestFactory } from '@nestjs/core'
import { AppModule } from '../src/app.module'
import { DatabaseService } from '../src/database/database.service'
import { PaymentsService } from '../src/payments/payments.service'
import { test } from 'node:test'

test('admin can disable and permanently delete customer accounts safely', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'azhar-admin-test-'))
  const previousDatabase = process.env.AZHAR_STORE_DB
  const previousUploadDirectory = process.env.AZHAR_STORE_UPLOAD_DIR
  const previousApiKey = process.env.CHATBOT_API_KEY
  delete process.env.CHATBOT_API_KEY
  process.env.AZHAR_STORE_DB = join(directory, 'test.sqlite')
  process.env.AZHAR_STORE_UPLOAD_DIR = join(directory, 'site-content')

  const app = await NestFactory.create(AppModule, { logger: false })
  try {
    await app.listen(0, '127.0.0.1')
    const address = app.getHttpServer().address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${address.port}`
    const database = app.get(DatabaseService)

    async function request(path: string, method = 'GET', body?: unknown, cookie?: string) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const contentType = response.headers.get('content-type') || ''
      const data = contentType.includes('application/json') ? await response.json() as any : null
      return { response, data }
    }

    async function register(email: string) {
      const result = await request('/api/auth/register', 'POST', {
        name: email,
        email,
        phone: '01000000000',
        password: 'TestPass1234',
      })
      assert.equal(result.response.status, 201, JSON.stringify(result.data))
      return result.response.headers.get('set-cookie')?.split(';', 1)[0] ?? ''
    }

    const adminCookie = await register('admin@example.test')
    const customerCookie = await register('customer@example.test')
    const adminId = database.db.prepare('SELECT id FROM users WHERE email=?').get('admin@example.test') as { id: string }
    const customerId = database.db.prepare('SELECT id FROM users WHERE email=?').get('customer@example.test') as { id: string }
    database.db.prepare("UPDATE users SET role='ADMIN' WHERE id=?").run(adminId.id)

    const presenceBefore = await request('/api/admin/users', 'GET', undefined, adminCookie)
    assert.equal(presenceBefore.data.find((account: any) => account.id === customerId.id).is_online, 1)
    database.db.prepare('UPDATE sessions SET last_seen_at=? WHERE user_id=?')
      .run(new Date(Date.now() - 3 * 60 * 1000).toISOString(), customerId.id)
    const presenceAfterTimeout = await request('/api/admin/users', 'GET', undefined, adminCookie)
    assert.equal(presenceAfterTimeout.data.find((account: any) => account.id === customerId.id).is_online, 0)
    const heartbeat = await request('/api/auth/presence', 'POST', {}, customerCookie)
    assert.equal(heartbeat.response.status, 201)
    const presenceAfterHeartbeat = await request('/api/admin/users', 'GET', undefined, adminCookie)
    assert.equal(presenceAfterHeartbeat.data.find((account: any) => account.id === customerId.id).is_online, 1)

    const categoryId = 'test-category'
    database.db.prepare('INSERT INTO categories (id,name,slug,sort_order) VALUES (?,?,?,?)')
      .run(categoryId, 'Test', 'test-category', 0)
    const updatedCategory = await request(`/api/admin/categories/${categoryId}`, 'PATCH', { name: 'Edited Test', slug: '' }, adminCookie)
    assert.equal(updatedCategory.response.status, 200)
    assert.equal(updatedCategory.data.name, 'Edited Test')
    assert.equal(updatedCategory.data.slug, 'edited-test')
    const productId = 'test-product'
    database.db.prepare(`
      INSERT INTO products (id,category_id,name,description,price,stock,created_at)
      VALUES (?,?,?,?,?,?,?)
    `).run(productId, categoryId, 'Test item', '', 100, 3, new Date().toISOString())

    const paymentOptionsBeforeSetup = await request('/api/payments/options')
    assert.deepEqual(paymentOptionsBeforeSetup.data.methods, ['COD'])
    const unavailablePaymob = await request('/api/orders', 'POST', {
      customerName: 'Customer',
      customerEmail: 'customer@example.test',
      phone: '01000000000',
      address: 'Test address',
      city: 'Test city',
      paymentMethod: 'PAYMOB',
      items: [{ id: productId, quantity: 1 }],
    })
    assert.equal(unavailablePaymob.response.status, 503)
    assert.equal((database.db.prepare('SELECT stock FROM products WHERE id=?').get(productId) as { stock: number }).stock, 3)

    const order = await request('/api/orders', 'POST', {
      customerName: 'Customer',
      phone: '01000000000',
      address: 'Test address',
      city: 'Test city',
      items: [{ id: productId, quantity: 1 }],
    }, customerCookie)
    assert.equal(order.response.status, 201)
    assert.equal(order.data.payment_method, 'COD')
    assert.equal(order.data.payment_status, 'NOT_REQUIRED')
    const ordersBeforeDelivery = await request('/api/admin/orders', 'GET', undefined, adminCookie)
    assert.ok(ordersBeforeDelivery.data.some((item: any) => item.id === order.data.id))
    const deliveredOrder = await request(`/api/admin/orders/${order.data.id}/status`, 'PATCH', { status: 'DELIVERED' }, adminCookie)
    assert.equal(deliveredOrder.data.status, 'DELIVERED')
    const ordersAfterDelivery = await request('/api/admin/orders', 'GET', undefined, adminCookie)
    assert.ok(!ordersAfterDelivery.data.some((item: any) => item.id === order.data.id))
    assert.equal((database.db.prepare('SELECT status FROM orders WHERE id=?').get(order.data.id) as { status: string }).status, 'DELIVERED')

    const paymobEnvironment = [
      'PAYMOB_API_KEY','PAYMOB_INTEGRATION_ID','PAYMOB_IFRAME_ID','PAYMOB_HMAC_SECRET',
      'PAYMOB_NOTIFICATION_URL','PAYMOB_RETURN_URL',
    ]
    const previousPaymobEnvironment = new Map(paymobEnvironment.map((key) => [key, process.env[key]]))
    for (const [key, value] of Object.entries({
      PAYMOB_API_KEY: 'test-paymob-api-key',
      PAYMOB_INTEGRATION_ID: '12345',
      PAYMOB_IFRAME_ID: '67890',
      PAYMOB_HMAC_SECRET: 'test-paymob-hmac-secret',
      PAYMOB_NOTIFICATION_URL: 'https://store.example.test/api/payments/paymob/webhook',
      PAYMOB_RETURN_URL: 'https://store.example.test/payment-result',
    })) process.env[key] = value
    const originalFetch = globalThis.fetch
    let remoteOrderId = 987650
    let paymentKeyRequest: Record<string, any> | undefined
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.startsWith('https://accept.paymob.com/api/')) {
        return originalFetch.call(globalThis, input, init)
      }
      if (url.endsWith('/auth/tokens')) return new Response(JSON.stringify({ token: 'test-auth-token' }), { status: 200 })
      if (url.endsWith('/ecommerce/orders')) {
        remoteOrderId += 1
        return new Response(JSON.stringify({ id: remoteOrderId }), { status: 201 })
      }
      if (url.endsWith('/acceptance/payment_keys')) {
        paymentKeyRequest = JSON.parse(String(init?.body)) as Record<string, any>
        return new Response(JSON.stringify({ token: 'test-payment-token' }), { status: 201 })
      }
      return new Response('{}', { status: 404 })
    }
    try {
      const paymentOptionsAfterSetup = await request('/api/payments/options')
      assert.deepEqual(paymentOptionsAfterSetup.data.methods, ['COD', 'PAYMOB'])
      const onlineOrder = await request('/api/orders', 'POST', {
        customerName: 'Customer',
        customerEmail: 'customer@example.test',
        phone: '01000000000',
        address: 'Test address',
        city: 'Test city',
        paymentMethod: 'PAYMOB',
        items: [{ id: productId, quantity: 1 }],
      })
      assert.equal(onlineOrder.response.status, 201)
      assert.match(onlineOrder.data.checkoutUrl, /accept\.paymob\.com\/api\/acceptance\/iframes\/67890/)
      assert.equal(onlineOrder.data.payment_status, 'PENDING')
      assert.equal(onlineOrder.data.payment_method, 'PAYMOB')
      assert.equal(paymentKeyRequest?.amount_cents, onlineOrder.data.total * 100)
      assert.match(paymentKeyRequest?.redirection_url, new RegExp(`order_ref=${onlineOrder.data.id}`))
      assert.equal((database.db.prepare('SELECT stock FROM products WHERE id=?').get(productId) as { stock: number }).stock, 1)

      const transaction = {
        amount_cents: onlineOrder.data.total * 100,
        created_at: new Date().toISOString(),
        currency: 'EGP',
        error_occured: false,
        has_parent_transaction: false,
        id: 556677,
        integration_id: 12345,
        is_3d_secure: true,
        is_auth: true,
        is_capture: true,
        is_refunded: false,
        is_standalone_payment: true,
        is_voided: false,
        order: { id: remoteOrderId, merchant_order_id: onlineOrder.data.id },
        owner: 123,
        pending: false,
        source_data: { pan: '2345', sub_type: 'card', type: 'card' },
        success: true,
      }
      const signTransaction = (value: typeof transaction) => {
        const fields = [
          value.amount_cents,value.created_at,value.currency,value.error_occured,
          value.has_parent_transaction,value.id,value.integration_id,value.is_3d_secure,
          value.is_auth,value.is_capture,value.is_refunded,value.is_standalone_payment,
          value.is_voided,value.order.id,value.owner,value.pending,
          value.source_data.pan,value.source_data.sub_type,value.source_data.type,value.success,
        ]
        return createHmac('sha512', 'test-paymob-hmac-secret')
          .update(fields.map((field) => String(field)).join(''))
          .digest('hex')
      }
      const hmac = signTransaction(transaction)
      const invalidWebhook = await request(`/api/payments/paymob/webhook?hmac=${'0'.repeat(128)}`, 'POST', { obj: transaction })
      assert.equal(invalidWebhook.response.status, 401)
      const webhook = await request(`/api/payments/paymob/webhook?hmac=${hmac}`, 'POST', { obj: transaction })
      assert.equal(webhook.response.status, 201)
      const paidStatus = await request(`/api/payments/status/${onlineOrder.data.id}`)
      assert.equal(paidStatus.data.paymentStatus, 'PAID')
      assert.equal(paidStatus.data.orderStatus, 'CONFIRMED')
      const duplicateWebhook = await request(`/api/payments/paymob/webhook?hmac=${hmac}`, 'POST', { obj: transaction })
      assert.equal(duplicateWebhook.response.status, 201)
      assert.equal((database.db.prepare('SELECT stock FROM products WHERE id=?').get(productId) as { stock: number }).stock, 1)

      const failedOrder = await request('/api/orders', 'POST', {
        customerName: 'Customer',
        customerEmail: 'customer@example.test',
        phone: '01000000000',
        address: 'Test address',
        city: 'Test city',
        paymentMethod: 'PAYMOB',
        items: [{ id: productId, quantity: 1 }],
      })
      assert.equal(failedOrder.response.status, 201)
      const failedTransaction = {
        ...transaction,
        created_at: new Date().toISOString(),
        error_occured: true,
        id: 556678,
        order: { id: Number(failedOrder.data.payment_reference), merchant_order_id: failedOrder.data.id },
        success: false,
      }
      const failedHmac = signTransaction(failedTransaction)
      const failureWebhook = await request(`/api/payments/paymob/webhook?hmac=${failedHmac}`, 'POST', { obj: failedTransaction })
      assert.equal(failureWebhook.response.status, 201)
      const failedStatus = await request(`/api/payments/status/${failedOrder.data.id}`)
      assert.equal(failedStatus.data.paymentStatus, 'FAILED')
      assert.equal(failedStatus.data.orderStatus, 'CANCELLED')
      assert.equal((database.db.prepare('SELECT stock FROM products WHERE id=?').get(productId) as { stock: number }).stock, 1)

      const expiredOrder = await request('/api/orders', 'POST', {
        customerName: 'Customer',
        customerEmail: 'customer@example.test',
        phone: '01000000000',
        address: 'Test address',
        city: 'Test city',
        paymentMethod: 'PAYMOB',
        items: [{ id: productId, quantity: 1 }],
      })
      assert.equal(expiredOrder.response.status, 201)
      database.db.prepare('UPDATE orders SET payment_expires_at=? WHERE id=?')
        .run(new Date(Date.now() - 1000).toISOString(), expiredOrder.data.id)
      app.get(PaymentsService).expirePendingPayments()
      const expiredStatus = await request(`/api/payments/status/${expiredOrder.data.id}`)
      assert.equal(expiredStatus.data.paymentStatus, 'EXPIRED')
      assert.equal(expiredStatus.data.orderStatus, 'CANCELLED')
      assert.equal((database.db.prepare('SELECT stock FROM products WHERE id=?').get(productId) as { stock: number }).stock, 1)

      const unauthorizedProductDelete = await request(`/api/admin/products/${productId}/permanent`, 'DELETE')
      assert.equal(unauthorizedProductDelete.response.status, 403)
      const deletedProduct = await request(`/api/admin/products/${productId}/permanent`, 'DELETE', undefined, adminCookie)
      assert.equal(deletedProduct.response.status, 200)
      assert.equal(database.db.prepare('SELECT id FROM products WHERE id=?').get(productId), undefined)
      const retainedProductOrder = database.db.prepare(`
        SELECT product_id,product_name,quantity,unit_price FROM order_items WHERE order_id=? AND product_name=?
      `).get(order.data.id, 'Test item') as { product_id: string | null; product_name: string; quantity: number; unit_price: number }
      assert.equal(retainedProductOrder.product_id, null)
      assert.equal(retainedProductOrder.product_name, 'Test item')
      assert.equal(retainedProductOrder.quantity, 1)
      assert.equal(retainedProductOrder.unit_price, 100)
    } finally {
      globalThis.fetch = originalFetch
      for (const [key, value] of previousPaymobEnvironment) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }

    const disabled = await request(`/api/admin/users/${customerId.id}/status`, 'PATCH', { status: 'DISABLED' }, adminCookie)
    assert.equal(disabled.response.status, 200)
    assert.equal(disabled.data.account_status, 'DISABLED')
    const disabledList = await request('/api/admin/users', 'GET', undefined, adminCookie)
    assert.equal(disabledList.data.find((account: any) => account.id === customerId.id).account_status, 'DISABLED')
    assert.equal(disabledList.data.find((account: any) => account.id === customerId.id).is_online, 0)

    const settings = await request('/api/admin/settings', 'PATCH', {
      home_title: 'سنتر تجريبي',
      department_books_title: 'كتب المركز',
      store_email: 'store@example.test',
      store_facebook: 'https://www.facebook.com/alazhar.center.eg/',
      store_instagram: 'https://www.instagram.com/alazhar.center.eg/',
      store_youtube: 'https://www.youtube.com/@AlAzharCenter',
      store_map_url: 'https://maps.app.goo.gl/n78L79Ru6HRC6uP3A',
      store_address: 'شارع المركز، شبين القناطر',
      site_accent_color: '#245a3d',
    }, adminCookie)
    assert.equal(settings.response.status, 200)
    assert.equal(settings.data.home_title, 'سنتر تجريبي')
    assert.equal(settings.data.department_books_title, 'كتب المركز')
    assert.equal(settings.data.store_email, 'store@example.test')
    assert.equal(settings.data.store_facebook, 'https://www.facebook.com/alazhar.center.eg/')
    assert.equal(settings.data.store_instagram, 'https://www.instagram.com/alazhar.center.eg/')
    assert.equal(settings.data.store_youtube, 'https://www.youtube.com/@AlAzharCenter')
    assert.equal(settings.data.store_map_url, 'https://maps.app.goo.gl/n78L79Ru6HRC6uP3A')
    assert.equal(settings.data.store_address, 'شارع المركز، شبين القناطر')
    assert.equal(settings.data.site_accent_color, '#245a3d')
    const unsupportedSetting = await request('/api/admin/settings', 'PATCH', { ignored_setting: 'must not be stored' }, adminCookie)
    assert.equal(unsupportedSetting.response.status, 400)
    const invalidColor = await request('/api/admin/settings', 'PATCH', { site_accent_color: 'not-a-color' }, adminCookie)
    assert.equal(invalidColor.response.status, 400)
    const invalidSocialLink = await request('/api/admin/settings', 'PATCH', { store_instagram: 'https://example.test/profile' }, adminCookie)
    assert.equal(invalidSocialLink.response.status, 400)

    const unauthorizedImage = await request('/api/admin/content-image', 'POST', {
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII=',
    })
    assert.equal(unauthorizedImage.response.status, 403)
    const uploadedImage = await request('/api/admin/content-image', 'POST', {
      dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII=',
    }, adminCookie)
    assert.equal(uploadedImage.response.status, 201)
    const publicImage = await request(uploadedImage.data.imageUrl)
    assert.equal(publicImage.response.status, 200)
    assert.match(publicImage.response.headers.get('content-type') || '', /image\/png/)
    assert.ok((await publicImage.response.arrayBuffer()).byteLength > 0)

    const initialSiteContent = await request('/api/admin/site-sections', 'GET', undefined, adminCookie)
    assert.equal(initialSiteContent.response.status, 200)
    assert.ok(initialSiteContent.data.length >= 6)
    const createdSection = await request('/api/admin/site-sections', 'POST', {
      kind: 'SECTION',
      title: 'خدمات المركز',
      description: 'طباعة الإجازات والمتون',
      isVisible: true,
    }, adminCookie)
    assert.equal(createdSection.response.status, 201)
    assert.equal(createdSection.data.title, 'خدمات المركز')
    const createdImage = await request('/api/admin/site-sections', 'POST', {
      kind: 'IMAGE',
      title: 'صورة جديدة',
      imageUrl: uploadedImage.data.imageUrl,
      isVisible: true,
    }, adminCookie)
    assert.equal(createdImage.response.status, 201)
    const publicContent = await request('/api/site-sections')
    assert.ok(publicContent.data.some((item: any) => item.id === createdSection.data.id))
    const hiddenSection = await request(`/api/admin/site-sections/${createdSection.data.id}`, 'PATCH', { isVisible: false }, adminCookie)
    assert.equal(hiddenSection.response.status, 200)
    assert.equal(hiddenSection.data.is_visible, 0)
    const publicContentAfterHide = await request('/api/site-sections')
    assert.ok(!publicContentAfterHide.data.some((item: any) => item.id === createdSection.data.id))
    const editedImage = await request(`/api/admin/site-sections/${createdImage.data.id}`, 'PATCH', { title: 'صورة معدلة' }, adminCookie)
    assert.equal(editedImage.data.title, 'صورة معدلة')
    const deletedImage = await request(`/api/admin/site-sections/${createdImage.data.id}`, 'DELETE', undefined, adminCookie)
    assert.equal(deletedImage.response.status, 200)
    assert.ok(!database.db.prepare('SELECT id FROM site_content WHERE id=?').get(createdImage.data.id))

    const deniedLogin = await request('/api/auth/login', 'POST', { email: 'customer@example.test', password: 'TestPass1234' })
    assert.equal(deniedLogin.response.status, 401)
    const expiredSession = await request('/api/auth/me', 'GET', undefined, customerCookie)
    assert.equal(expiredSession.data.user, null)

    const reactivated = await request(`/api/admin/users/${disabled.data.id}/status`, 'PATCH', { status: 'ACTIVE' }, adminCookie)
    assert.equal(reactivated.response.status, 200)
    assert.equal(reactivated.data.account_status, 'ACTIVE')
    const activeList = await request('/api/admin/users', 'GET', undefined, adminCookie)
    assert.equal(activeList.data.find((account: any) => account.id === customerId.id).account_status, 'ACTIVE')

    const deleted = await request(`/api/admin/users/${disabled.data.id}`, 'DELETE', undefined, adminCookie)
    assert.equal(deleted.response.status, 200)
    assert.equal(database.db.prepare('SELECT id FROM users WHERE id=?').get(disabled.data.id), undefined)
    const retainedOrder = database.db.prepare('SELECT user_id FROM orders WHERE id=?').get(order.data.id) as { user_id: string | null }
    assert.equal(retainedOrder.user_id, null)

    const adminChat = await request('/api/chatbot/message', 'POST', { message: 'Hello' })
    assert.equal(adminChat.response.status, 503)
  } finally {
    await app.close()
    if (previousDatabase === undefined) delete process.env.AZHAR_STORE_DB
    else process.env.AZHAR_STORE_DB = previousDatabase
    if (previousUploadDirectory === undefined) delete process.env.AZHAR_STORE_UPLOAD_DIR
    else process.env.AZHAR_STORE_UPLOAD_DIR = previousUploadDirectory
    if (previousApiKey === undefined) delete process.env.CHATBOT_API_KEY
    else process.env.CHATBOT_API_KEY = previousApiKey
    rmSync(directory, { recursive: true, force: true })
  }
})

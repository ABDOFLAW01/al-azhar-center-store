import { BadRequestException, Controller, Delete, Get, Param, Patch, Post, Req, Body, ForbiddenException, Inject, NotFoundException, StreamableFile, Query, UnauthorizedException } from '@nestjs/common'
import type { Request } from 'express'
import { randomUUID, createHash } from 'node:crypto'
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { DatabaseService } from '../database/database.service'
import { saveMedia } from '../database/media'
import { PaymentsService, type PaymobTransaction } from '../payments/payments.service'

const editableSettings = new Set([
  'store_name','store_location','store_whatsapp','store_email','store_facebook','store_instagram','store_youtube','store_map_url','store_address','site_accent_color',
  'home_kicker','home_title','home_emphasis','home_description','home_primary_button','home_secondary_button',
  'home_image_main','home_image_side','home_image_bottom',
  'home_departments_eyebrow','home_departments_title','home_departments_description',
  'home_intro_eyebrow','home_intro_title','home_intro_description','home_intro_button',
  'home_intro_image_main','home_intro_image_side',
  'home_contact_eyebrow','home_contact_title','home_contact_description','home_contact_button',
  'department_attire_title','department_attire_description','department_attire_image',
  'department_books_title','department_books_description','department_books_image',
  'department_tajweed_title','department_tajweed_description','department_tajweed_image',
  'department_gifts_title','department_gifts_description','department_gifts_image',
  'department_worship_title','department_worship_description','department_worship_image',
  'department_printing_title','department_printing_description','department_printing_image',
  'hero_eyebrow','hero_title','hero_emphasis','hero_description','hero_button',
  'about_eyebrow','about_title','about_description','about_gallery_eyebrow','about_gallery_title','about_gallery_description',
  'about_gallery_1_caption','about_gallery_2_caption','about_gallery_3_caption','about_gallery_4_caption','about_gallery_5_caption','about_gallery_6_caption',
  'about_gallery_1_image','about_gallery_2_image','about_gallery_3_image','about_gallery_4_image','about_gallery_5_image','about_gallery_6_image',
  'contact_eyebrow','contact_title','contact_assistant_description','contact_orders_description',
  'shipping_fee','free_shipping_threshold','footer_text','footer_description',
])

function getToken(request: Request) {
  const cookie = request.headers.cookie ?? ''
  return cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith('azhar_session='))?.slice(14)
}

@Controller('api')
export class StoreController {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  private async user(request: Request) {
    const token = getToken(request)
    if (!token) return null
    const hash = createHash('sha256').update(token).digest('hex')
    return this.database.db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? 
    `).get(hash, new Date().toISOString()) as any
  }

  @Get('health')
  async health() {
    await this.database.db.prepare('SELECT 1').get()
    return { ok: true, database: 'connected' }
  }

  @Get('categories')
  async categories() {
    return this.database.db.prepare('SELECT id,name,slug FROM categories ORDER BY sort_order').all()
  }

  @Get('settings')
  async settings() {
    const rows = await this.database.db.prepare('SELECT key,value FROM store_settings').all() as Array<{ key: string; value: string }>
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }

  @Get('site-sections')
  async siteSections() {
    return this.database.db.prepare(`
      SELECT id,kind,title,description,image_url,sort_order,is_visible
      FROM site_content WHERE is_visible=1 ORDER BY sort_order,created_at
    `).all()
  }

  @Get('payments/options')
  paymentOptions() {
    return this.payments.publicOptions()
  }

  @Get('payments/status/:id')
  async paymentStatus(@Param('id') id: string) {
    const order = await this.database.db.prepare(`
      SELECT id,payment_method,payment_status,status FROM orders WHERE id=?
    `).get(id) as {
      id: string; payment_method: string; payment_status: string; status: string
    } | undefined
    if (!order) throw new NotFoundException('الطلب غير موجود')
    return {
      orderId: order.id,
      method: order.payment_method,
      paymentStatus: order.payment_status,
      orderStatus: order.status,
    }
  }

  @Post('payments/paymob/webhook')
  async paymobWebhook(@Query('hmac') hmac: string, @Body() body: { obj?: PaymobTransaction }) {
    const transaction = body?.obj
    if (!transaction || !this.payments.verifyWebhook(transaction, hmac ?? '')) {
      throw new UnauthorizedException('توقيع إشعار الدفع غير صحيح')
    }
    if (Number(transaction.integration_id) !== this.payments.expectedIntegrationId()) {
      throw new UnauthorizedException('معرّف تكامل الدفع غير صحيح')
    }

    const orderId = String(transaction.order?.merchant_order_id ?? '')
    const order = await this.database.db.prepare(`
      SELECT id,total,payment_method,payment_status,payment_reference,payment_expires_at
      FROM orders WHERE id=?
    `).get(orderId) as {
      id: string; total: number; payment_method: string; payment_status: string
      payment_reference: string; payment_expires_at: string
    } | undefined
    if (!order || order.payment_method !== 'PAYMOB') throw new NotFoundException('طلب الدفع غير موجود')
    if (String(transaction.order?.id ?? '') !== order.payment_reference ||
        Number(transaction.amount_cents) !== order.total * 100 ||
        transaction.currency !== 'EGP') {
      throw new BadRequestException('بيانات معاملة الدفع لا تطابق الطلب')
    }

    const isTrue = (value: boolean | string | undefined) => value === true || value === 'true'
    if (isTrue(transaction.pending)) return { ok: true }
    const transactionId = String(transaction.id ?? '')
    const succeeded = isTrue(transaction.success)
    await this.database.db.transaction(async () => {
      const lockedOrder = await this.database.db.prepare(`
        UPDATE orders SET payment_status=payment_status
        WHERE id=? AND payment_status NOT IN ('PAID','REVIEW')
      `).run(order.id)
      if (lockedOrder.changes === 0) return
      const current = await this.database.db.prepare(`
        SELECT payment_status,payment_expires_at FROM orders WHERE id=?
      `).get(order.id) as { payment_status: string; payment_expires_at: string }

      if (succeeded) {
        const transactionTime = Date.parse(transaction.created_at ?? '')
        const expiresAt = Date.parse(current.payment_expires_at)
        const validWindow = Number.isFinite(transactionTime) &&
          (!Number.isFinite(expiresAt) || transactionTime <= expiresAt)
        const items = await this.database.db.prepare(`
          SELECT product_id,quantity FROM order_items WHERE order_id=?
        `).all(order.id) as Array<{ product_id: string | null; quantity: number }>
        if (!validWindow) {
          await this.database.db.prepare(`
            UPDATE orders SET payment_status='REVIEW',payment_transaction_id=? WHERE id=?
          `).run(transactionId, order.id)
        } else if (current.payment_status !== 'PENDING') {
          let canReserve = true
          for (const item of items) {
            if (!item.product_id) {
              canReserve = false
              continue
            }
            const product = await this.database.db.prepare('SELECT stock FROM products WHERE id=?').get(item.product_id) as { stock: number } | undefined
            if (!product || product.stock < item.quantity) canReserve = false
          }
          if (!canReserve) {
            await this.database.db.prepare(`
              UPDATE orders SET payment_status='REVIEW',payment_transaction_id=? WHERE id=?
            `).run(transactionId, order.id)
          } else {
            for (const item of items) {
              await this.database.db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(item.quantity, item.product_id)
            }
            await this.database.db.prepare(`
              UPDATE orders SET payment_status='PAID',payment_transaction_id=?,status='CONFIRMED' WHERE id=?
            `).run(transactionId, order.id)
          }
        } else {
          await this.database.db.prepare(`
            UPDATE orders SET payment_status='PAID',payment_transaction_id=?,status='CONFIRMED' WHERE id=?
          `).run(transactionId, order.id)
        }
      } else if (current.payment_status === 'PENDING') {
        const items = await this.database.db.prepare(`
          SELECT product_id,quantity FROM order_items WHERE order_id=?
        `).all(order.id) as Array<{ product_id: string | null; quantity: number }>
        for (const item of items) {
          if (item.product_id) await this.database.db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(item.quantity, item.product_id)
        }
        await this.database.db.prepare(`
          UPDATE orders SET payment_status='FAILED',payment_transaction_id=?,status='CANCELLED' WHERE id=?
        `).run(transactionId, order.id)
      }
    })
    return { ok: true }
  }

  @Get('admin/site-sections')
  async adminSiteSections(@Req() req: Request) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    return this.database.db.prepare(`
      SELECT id,kind,title,description,image_url,sort_order,is_visible
      FROM site_content ORDER BY sort_order,created_at
    `).all()
  }

  @Post('admin/site-sections')
  async createSiteSection(@Req() req: Request, @Body() body: {
    kind: string; title: string; description?: string; imageUrl?: string; isVisible?: boolean
  }) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    if (body.kind !== 'IMAGE' && body.kind !== 'SECTION') throw new BadRequestException('نوع المحتوى غير صحيح')
    const title = body.title?.trim()
    const description = String(body.description ?? '').trim()
    const imageUrl = String(body.imageUrl ?? '').trim()
    if (!title) throw new BadRequestException('عنوان المحتوى مطلوب')
    if (title.length > 150 || description.length > 2000) throw new BadRequestException('المحتوى أطول من الحد المسموح')
    if (body.kind === 'IMAGE' && !imageUrl) throw new BadRequestException('صورة المعرض مطلوبة')
    this.validateImageUrl(imageUrl)
    const order = await this.database.db.prepare('SELECT COALESCE(MAX(sort_order),0)+10 AS next FROM site_content').get() as { next: number }
    const id = randomUUID()
    await this.database.db.prepare(`
      INSERT INTO site_content (id,kind,title,description,image_url,sort_order,is_visible,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id,body.kind,title,description,imageUrl,order.next,body.isVisible === false ? 0 : 1,new Date().toISOString())
    return this.siteContentItem(id)
  }

  @Patch('admin/site-sections/:id')
  async updateSiteSection(@Req() req: Request, @Param('id') id: string, @Body() body: {
    kind?: string; title?: string; description?: string; imageUrl?: string; isVisible?: boolean
  }) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const current = await this.siteContentItem(id) as { kind: string; image_url: string } | undefined
    if (!current) throw new NotFoundException('المحتوى غير موجود')
    if (body.kind != null && body.kind !== 'IMAGE' && body.kind !== 'SECTION') throw new BadRequestException('نوع المحتوى غير صحيح')
    const title = body.title == null ? null : body.title.trim()
    const description = body.description == null ? null : body.description.trim()
    const imageUrl = body.imageUrl == null ? null : body.imageUrl.trim()
    if (title !== null && !title) throw new BadRequestException('عنوان المحتوى مطلوب')
    if ((title?.length ?? 0) > 150 || (description?.length ?? 0) > 2000) throw new BadRequestException('المحتوى أطول من الحد المسموح')
    if (imageUrl !== null) this.validateImageUrl(imageUrl)
    const nextKind = body.kind ?? current.kind
    const nextImage = imageUrl ?? current.image_url
    if (nextKind === 'IMAGE' && !nextImage) throw new BadRequestException('صورة المعرض مطلوبة')
    const isVisible = body.isVisible == null ? null : (body.isVisible ? 1 : 0)
    await this.database.db.prepare(`
      UPDATE site_content SET kind=COALESCE(?,kind),title=COALESCE(?,title),
      description=COALESCE(?,description),image_url=COALESCE(?,image_url),
      is_visible=COALESCE(?,is_visible) WHERE id=?
    `).run(body.kind ?? null,title,description,imageUrl,isVisible,id)
    return this.siteContentItem(id)
  }

  @Delete('admin/site-sections/:id')
  async deleteSiteSection(@Req() req: Request, @Param('id') id: string) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const result = await this.database.db.prepare('DELETE FROM site_content WHERE id=?').run(id)
    if (result.changes === 0) throw new NotFoundException('المحتوى غير موجود')
    return { ok: true }
  }

  private validateImageUrl(value: string) {
    if (!value) return
    if (value.startsWith('/') && !value.startsWith('//')) return
    let url: URL
    try { url = new URL(value) }
    catch { throw new BadRequestException('رابط الصورة غير صحيح') }
    if (url.protocol !== 'https:') throw new BadRequestException('رابط الصورة يجب أن يستخدم HTTPS')
  }

  private async siteContentItem(id: string) {
    return this.database.db.prepare(`
      SELECT id,kind,title,description,image_url,sort_order,is_visible
      FROM site_content WHERE id=?
    `).get(id) as {
      id: string; kind: string; title: string; description: string; image_url: string; sort_order: number; is_visible: number
    } | undefined
  }

  @Get('products')
  async products() {
    return this.database.db.prepare(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p JOIN categories c ON c.id=p.category_id
      WHERE p.is_active=1 ORDER BY p.is_featured DESC,p.created_at DESC
    `).all()
  }

  @Get('products/:id')
  async product(@Param('id') id: string) {
    const product = await this.database.db.prepare(`
      SELECT p.*, c.name AS category_name, c.slug AS category_slug
      FROM products p JOIN categories c ON c.id=p.category_id
      WHERE p.id=? AND p.is_active=1
    `).get(id)
    if (!product) throw new BadRequestException('المنتج غير موجود')
    return product
  }

  @Post('orders')
  async createOrder(@Req() req: Request, @Body() body: {
    items?: Array<{ id: string; quantity: number }>
    customerName: string
    customerEmail?: string
    phone: string
    address: string
    city: string
    notes?: string
    paymentMethod?: string
  }) {
    const items = Array.isArray(body.items) ? body.items : []
    if (items.length === 0) throw new BadRequestException('السلة فارغة')
    if (!body.customerName || !body.phone || !body.address || !body.city) {
      throw new BadRequestException('يرجى إكمال بيانات التوصيل')
    }
    const paymentMethod = body.paymentMethod ?? 'COD'
    if (paymentMethod !== 'COD' && paymentMethod !== 'PAYMOB') {
      throw new BadRequestException('طريقة الدفع غير مدعومة')
    }
    const customerEmail = String(body.customerEmail ?? '').trim()
    if (paymentMethod === 'PAYMOB' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      throw new BadRequestException('أدخل بريدًا إلكترونيًا صحيحًا لإتمام الدفع الإلكتروني')
    }
    let subtotal = 0
    const resolvedItems: Array<{ id: string; name: string; quantity: number; price: number }> = []
    const quantities = new Map<string, number>()
    for (const item of items) {
      if (!item?.id) throw new BadRequestException('يوجد منتج غير صالح في السلة')
      const requestedQuantity = Math.max(Number(item.quantity) || 1, 1)
      quantities.set(item.id, (quantities.get(item.id) ?? 0) + requestedQuantity)
    }
    for (const [productId, requestedQuantity] of quantities) {
      const product = await this.database.db.prepare('SELECT id,name,price,stock,is_active FROM products WHERE id=?').get(productId) as {
        id: string; name: string; price: number; stock: number; is_active: number
      } | undefined
      if (!product || product.is_active !== 1) throw new BadRequestException('يوجد منتج غير متاح')
      const quantity = Math.min(requestedQuantity, product.stock)
      if (quantity < 1) throw new BadRequestException(`نفد مخزون ${product.name}`)
      subtotal += product.price * quantity
      resolvedItems.push({ id: product.id, name: product.name, quantity, price: product.price })
    }
    const setting = async (key: string, fallback: number) => {
      const row = await this.database.db.prepare('SELECT value FROM store_settings WHERE key=?').get(key) as { value: string } | undefined
      return Number(row?.value ?? fallback)
    }
    const shipping = subtotal >= await setting('free_shipping_threshold', 500) ? 0 : await setting('shipping_fee', 35)
    const total = subtotal + shipping
    if (paymentMethod === 'PAYMOB' && total < 1) {
      throw new BadRequestException('يجب أن يكون إجمالي الطلب أكبر من صفر لإتمام الدفع الإلكتروني')
    }
    const orderId = randomUUID()
    const now = new Date().toISOString()
    const user = await this.user(req)
    const checkout = paymentMethod === 'PAYMOB'
      ? await this.payments.createPaymobCheckout({
          orderId,
          total,
          billing: {
            name: body.customerName.trim(),
            email: customerEmail,
            phone: body.phone.trim(),
            address: body.address.trim(),
            city: body.city.trim(),
          },
          items: resolvedItems.map((item) => ({ name: item.name, quantity: item.quantity, unitPrice: item.price })),
        })
      : null
    await this.database.db.transaction(async () => {
      for (const item of resolvedItems) {
        const stock = await this.database.db.prepare(`
          SELECT stock FROM products WHERE id=? AND is_active=1
        `).get(item.id) as { stock: number } | undefined
        if (!stock || stock.stock < item.quantity) throw new BadRequestException(`لم تعد كمية ${item.name} متاحة بالكامل`)
      }
      await this.database.db.prepare(`
        INSERT INTO orders (
          id,user_id,customer_name,customer_email,phone,address,city,notes,subtotal,shipping,total,
          status,payment_method,payment_status,payment_reference,payment_expires_at,created_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'PENDING',?,?,?,?,?)
      `).run(
        orderId,user?.id ?? null,body.customerName.trim(),customerEmail,body.phone.trim(),body.address.trim(),
        body.city.trim(),String(body.notes ?? '').trim(),subtotal,shipping,total,paymentMethod,
        checkout ? 'PENDING' : 'NOT_REQUIRED',checkout?.paymentReference ?? '',
        checkout?.paymentExpiresAt ?? '',now,
      )
      for (const item of resolvedItems) {
        await this.database.db.prepare(`
          INSERT INTO order_items (id,order_id,product_id,product_name,quantity,unit_price)
          VALUES (?,?,?,?,?,?)
        `).run(randomUUID(),orderId,item.id,item.name,item.quantity,item.price)
        const updated = await this.database.db.prepare(`
          UPDATE products SET stock=stock-? WHERE id=? AND stock>=? AND is_active=1
        `).run(item.quantity,item.id,item.quantity)
        if (updated.changes === 0) throw new BadRequestException(`لم تعد كمية ${item.name} متاحة بالكامل`)
      }
    })
    return { ...(await this.order(orderId)), ...(checkout ? { checkoutUrl: checkout.checkoutUrl } : {}) }
  }

  @Get('orders/mine')
  async myOrders(@Req() req: Request) {
    const user = await this.user(req)
    if (!user) return []
    return this.database.db.prepare('SELECT * FROM orders WHERE user_id=? ORDER BY created_at DESC').all(user.id)
  }

  @Get('orders/:id')
  async order(@Param('id') id: string) {
    const order = await this.database.db.prepare('SELECT * FROM orders WHERE id=?').get(id)
    if (!order) throw new BadRequestException('الطلب غير موجود')
    const items = await this.database.db.prepare('SELECT * FROM order_items WHERE order_id=?').all(id)
    return { ...(order as object), items }
  }

  @Get('admin/products')
  async adminProducts(@Req() req: Request) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    return this.database.db.prepare(`
      SELECT p.*, c.name AS category_name
      FROM products p LEFT JOIN categories c ON c.id=p.category_id
      ORDER BY p.created_at DESC
    `).all()
  }

  @Post('admin/categories')
  async createCategory(@Req() req: Request, @Body() body: { name: string; slug?: string }) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    if (!body.name?.trim()) throw new BadRequestException('اسم التصنيف مطلوب')
    const id = randomUUID()
    const slug = (body.slug?.trim() || body.name.trim())
      .toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || id
    const sortRow = await this.database.db.prepare('SELECT COALESCE(MAX(sort_order),-1)+1 AS next FROM categories').get() as { next: number }
    await this.database.db.prepare('INSERT INTO categories (id,name,slug,sort_order) VALUES (?,?,?,?)').run(id,body.name.trim(),slug,sortRow.next)
    return this.database.db.prepare('SELECT * FROM categories WHERE id=?').get(id)
  }

  @Patch('admin/categories/:id')
  async updateCategory(@Req() req: Request, @Param('id') id: string, @Body() body: { name?: string; slug?: string }) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const name = body.name?.trim()
    const requestedSlug = body.slug?.trim()
    const slug = requestedSlug || (name
      ? name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      : '')
    await this.database.db.prepare(`
      UPDATE categories SET name=COALESCE(?,name), slug=COALESCE(?,slug), sort_order=COALESCE(?,sort_order) WHERE id=?
    `).run(name || null,slug || null,(body as any).sortOrder == null ? null : Number((body as any).sortOrder),id)
    return this.database.db.prepare('SELECT * FROM categories WHERE id=?').get(id)
  }

  @Delete('admin/categories/:id')
  async deleteCategory(@Req() req: Request, @Param('id') id: string) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const productCount = await this.database.db.prepare('SELECT COUNT(*) AS count FROM products WHERE category_id=?').get(id) as { count: number }
    if (productCount.count > 0) throw new BadRequestException('لا يمكن حذف تصنيف يحتوي منتجات')
    await this.database.db.prepare('DELETE FROM categories WHERE id=?').run(id)
    return { ok: true }
  }

  @Patch('admin/settings')
  async updateSettings(@Req() req: Request, @Body() body: Record<string, unknown>) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    for (const [key, value] of Object.entries(body)) {
      if (!editableSettings.has(key)) throw new BadRequestException(`إعداد غير مدعوم: ${key}`)
      if (typeof value !== 'string' && typeof value !== 'number') throw new BadRequestException(`قيمة الإعداد ${key} غير صحيحة`)
      const cleanValue = String(value).trim()
      if (['shipping_fee','free_shipping_threshold'].includes(key) && (!Number.isFinite(Number(cleanValue)) || Number(cleanValue) < 0)) {
        throw new BadRequestException('قيمة الشحن يجب أن تكون رقمًا غير سالب')
      }
      if (key === 'site_accent_color' && !/^#[0-9a-f]{6}$/i.test(cleanValue)) {
        throw new BadRequestException('لون الموقع غير صحيح')
      }
      if (key === 'store_whatsapp' && cleanValue) {
        const digits = cleanValue.replace(/\D/g, '')
        if (digits.length < 8 || digits.length > 15) throw new BadRequestException('رقم واتساب غير صحيح')
      }
      if (key === 'store_email' && cleanValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanValue)) {
        throw new BadRequestException('البريد الإلكتروني غير صحيح')
      }
      if (key === 'store_facebook' && cleanValue && !/^https:\/\/(www\.)?facebook\.com\//i.test(cleanValue)) {
        throw new BadRequestException('رابط فيسبوك يجب أن يبدأ برابط آمن من facebook.com')
      }
      if (['store_instagram','store_youtube','store_map_url'].includes(key) && cleanValue) {
        let url: URL
        try { url = new URL(cleanValue) }
        catch { throw new BadRequestException('رابط التواصل غير صحيح') }
        const validHost = key === 'store_instagram'
          ? /(^|\.)instagram\.com$/i.test(url.hostname)
          : key === 'store_youtube'
            ? /(^|\.)youtube\.com$/i.test(url.hostname)
            : /(^|\.)maps\.app\.goo\.gl$/i.test(url.hostname) || /(^|\.)google\.com$/i.test(url.hostname)
        if (url.protocol !== 'https:' || !validHost) throw new BadRequestException('رابط التواصل يجب أن يكون آمنًا ومن الموقع الصحيح')
      }
      if (key.includes('_image') && cleanValue) {
        let url: URL | undefined
        try {
          if (!cleanValue.startsWith('/') || cleanValue.startsWith('//')) url = new URL(cleanValue)
        }
        catch { throw new BadRequestException('رابط الصورة غير صحيح') }
        if (url && url.protocol !== 'https:') throw new BadRequestException('رابط الصورة يجب أن يستخدم HTTPS')
      }
      if (cleanValue.length > 2000) throw new BadRequestException('قيمة الإعداد طويلة جدًا')
      await this.database.db.prepare('INSERT OR REPLACE INTO store_settings (key,value) VALUES (?,?)').run(key,cleanValue)
    }
    return this.settings()
  }

  @Post('admin/content-image')
  async uploadContentImage(@Req() req: Request, @Body() body: { dataUrl: string }) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(body.dataUrl ?? '')
    if (!match) throw new BadRequestException('ارفع صورة PNG أو JPG أو WebP')
    const image = Buffer.from(match[2], 'base64')
    if (image.length > 3 * 1024 * 1024) throw new BadRequestException('حجم الصورة يجب ألا يتجاوز 3 ميجابايت')
    return { imageUrl: await saveMedia(this.database.db, match[1], image) }
  }

  @Get('media/:id')
  async media(@Param('id') id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new NotFoundException('الصورة غير موجودة')
    const media = await this.database.db.prepare('SELECT content_type,data FROM media WHERE id=?').get(id) as {
      content_type: string; data: Uint8Array
    } | undefined
    if (!media) throw new NotFoundException('الصورة غير موجودة')
    return new StreamableFile(Buffer.from(media.data), { type: media.content_type, disposition: 'inline' })
  }

  @Get('site-content/:fileName')
  siteContent(@Param('fileName') fileName: string) {
    if (!/^[a-f0-9-]{36}\.(png|jpg|webp)$/i.test(fileName)) throw new NotFoundException('الصورة غير موجودة')
    const filePath = resolve(process.env.AZHAR_STORE_UPLOAD_DIR ?? '.data/site-content', fileName)
    if (!existsSync(filePath)) throw new NotFoundException('الصورة غير موجودة')
    const extension = extname(fileName).toLowerCase()
    const type = extension === '.png' ? 'image/png' : extension === '.jpg' ? 'image/jpeg' : 'image/webp'
    return new StreamableFile(readFileSync(filePath), { type, disposition: `inline; filename="${fileName}"` })
  }

  @Post('admin/logo')
  async uploadLogo(@Req() req: Request, @Body() body: { dataUrl: string }) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(body.dataUrl ?? '')
    if (!match) throw new BadRequestException('صيغة الشعار يجب أن تكون PNG أو JPG أو WebP')
    const imageUrl = await saveMedia(this.database.db, match[1], Buffer.from(match[2], 'base64'))
    await this.database.db.prepare('INSERT OR REPLACE INTO store_settings (key,value) VALUES (?,?)').run('logo_url',imageUrl)
    return { imageUrl }
  }

  @Post('admin/product-image')
  async uploadProductImage(@Req() req: Request, @Body() body: { dataUrl: string }) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/.exec(body.dataUrl ?? '')
    if (!match) throw new BadRequestException('صيغة الصورة يجب أن تكون PNG أو JPG أو WebP')
    return { imageUrl: await saveMedia(this.database.db, match[1], Buffer.from(match[2], 'base64')) }
  }

  @Get('admin/users')
  async adminUsers(@Req() req: Request) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const now = new Date().toISOString()
    const onlineSince = new Date(Date.now() - 2 * 60 * 1000).toISOString()
    return this.database.db.prepare(`
      SELECT id,name,email,phone,role,account_status,created_at,last_seen_at,
        CASE WHEN account_status='ACTIVE' AND EXISTS (
          SELECT 1 FROM sessions
          WHERE sessions.user_id=users.id AND sessions.expires_at>? AND sessions.last_seen_at>=?
        ) THEN 1 ELSE 0 END AS is_online
      FROM users
      ORDER BY created_at DESC
    `).all(now, onlineSince)
  }

  @Patch('admin/users/:id/status')
  async updateUserStatus(@Req() req: Request, @Param('id') id: string, @Body() body: { status: string }) {
    const actor = await this.user(req)
    if (actor?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبة')
    if (body.status !== 'ACTIVE' && body.status !== 'DISABLED') throw new BadRequestException('حالة الحساب غير صحيحة')
    const target = await this.database.db.prepare('SELECT id,role FROM users WHERE id=?').get(id) as { id: string; role: string } | undefined
    if (!target) throw new BadRequestException('الحساب غير موجود')
    if (target.role === 'ADMIN') throw new BadRequestException('لا يمكن تعطيل حساب مدير من هذه الشاشة')

    await this.database.db.transaction(async () => {
      await this.database.db.prepare('UPDATE users SET account_status=? WHERE id=?').run(body.status,id)
      if (body.status === 'DISABLED') {
        await this.database.db.prepare('DELETE FROM sessions WHERE user_id=?').run(id)
      }
    })
    return this.database.db.prepare('SELECT id,name,email,phone,role,account_status,created_at FROM users WHERE id=?').get(id)
  }

  @Delete('admin/users/:id')
  async deleteUser(@Req() req: Request, @Param('id') id: string) {
    const actor = await this.user(req)
    if (actor?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبة')
    if (actor.id === id) throw new BadRequestException('لا يمكنك حذف حسابك أثناء تسجيل الدخول')
    const target = await this.database.db.prepare('SELECT id,role FROM users WHERE id=?').get(id) as { id: string; role: string } | undefined
    if (!target) throw new BadRequestException('الحساب غير موجود')
    if (target.role === 'ADMIN') throw new BadRequestException('لا يمكن حذف حساب مدير من هذه الشاشة')

    await this.database.db.transaction(async () => {
      await this.database.db.prepare('UPDATE orders SET user_id=NULL WHERE user_id=?').run(id)
      await this.database.db.prepare('DELETE FROM users WHERE id=?').run(id)
    })
    return { ok: true }
  }

  @Get('admin/media')
  async adminMedia(@Req() req: Request) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const directory = resolve(process.cwd(), 'public', 'catalog')
    if (!existsSync(directory)) return []
    return readdirSync(directory)
      .filter((fileName) => /\.(png|jpe?g|webp|gif)$/i.test(fileName))
      .sort()
      .map((fileName) => ({ name: fileName, url: `/catalog/${fileName}` }))
  }

  @Get('admin/orders')
  async adminOrders(@Req() req: Request) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    return this.database.db.prepare("SELECT * FROM orders WHERE status!='DELIVERED' ORDER BY created_at DESC").all()
  }

  @Patch('admin/orders/:id/status')
  async updateOrderStatus(@Req() req: Request, @Param('id') id: string, @Body() body: { status: string }) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const allowed = ['PENDING','CONFIRMED','SHIPPED','DELIVERED','CANCELLED']
    if (!allowed.includes(body.status)) throw new BadRequestException('حالة الطلب غير صحيحة')
    await this.database.db.prepare('UPDATE orders SET status=? WHERE id=?').run(body.status,id)
    return this.order(id)
  }

  @Post('admin/products')
  async createProduct(@Req() req: Request, @Body() body: any) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    if (!body.name || !body.categoryId || !body.price) throw new BadRequestException('بيانات المنتج غير مكتملة')
    const id = randomUUID()
    await this.database.db.prepare(`
      INSERT INTO products (id,category_id,name,description,price,old_price,stock,image_url,is_featured,is_active,sku,barcode,brand,unit,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id,body.categoryId,body.name.trim(),String(body.description ?? '').trim(),Number(body.price),body.oldPrice ? Number(body.oldPrice) : null,Number(body.stock ?? 0),String(body.imageUrl ?? ''),body.featured ? 1 : 0,body.isActive == null ? 1 : (body.isActive ? 1 : 0),String(body.sku ?? '').trim(),String(body.barcode ?? '').trim(),String(body.brand ?? '').trim(),String(body.unit ?? 'قطعة').trim(),new Date().toISOString())
    return this.database.db.prepare('SELECT * FROM products WHERE id=?').get(id)
  }

  @Patch('admin/products/:id')
  async updateProduct(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    await this.database.db.prepare(`
      UPDATE products SET name=COALESCE(?,name), description=COALESCE(?,description),
      price=COALESCE(?,price), old_price=COALESCE(?,old_price), stock=COALESCE(?,stock),
      image_url=COALESCE(?,image_url), is_featured=COALESCE(?,is_featured),
      is_active=COALESCE(?,is_active), category_id=COALESCE(?,category_id),
      sku=COALESCE(?,sku), barcode=COALESCE(?,barcode), brand=COALESCE(?,brand), unit=COALESCE(?,unit)
      WHERE id=?
    `).run(body.name?.trim(),body.description?.trim(),body.price == null ? null : Number(body.price),body.oldPrice == null ? null : Number(body.oldPrice),body.stock == null ? null : Number(body.stock),body.imageUrl,body.featured == null ? null : (body.featured ? 1 : 0),body.isActive == null ? null : (body.isActive ? 1 : 0),body.categoryId ?? null,body.sku?.trim(),body.barcode?.trim(),body.brand?.trim(),body.unit?.trim(),id)
    return this.database.db.prepare('SELECT * FROM products WHERE id=?').get(id)
  }

  @Delete('admin/products/:id')
  async deleteProduct(@Req() req: Request, @Param('id') id: string) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    await this.database.db.prepare('UPDATE products SET is_active=0 WHERE id=?').run(id)
    return { ok: true }
  }

  @Delete('admin/products/:id/permanent')
  async permanentlyDeleteProduct(@Req() req: Request, @Param('id') id: string) {
    if ((await this.user(req))?.role !== 'ADMIN') throw new ForbiddenException('صلاحيات الأدمن مطلوبه')
    const result = await this.database.db.prepare('DELETE FROM products WHERE id=?').run(id)
    if (result.changes === 0) throw new NotFoundException('المنتج غير موجود')
    return { ok: true }
  }
}

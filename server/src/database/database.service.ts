import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: DatabaseSync

  constructor() {
    const databasePath = resolve(process.env.AZHAR_STORE_DB ?? '.data/al-azhar-store.sqlite')
    mkdirSync(dirname(databasePath), { recursive: true })
    this.db = new DatabaseSync(databasePath)
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        phone TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'CUSTOMER' CHECK (role IN ('CUSTOMER','ADMIN')),
        account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','DISABLED')),
        last_seen_at TEXT NOT NULL DEFAULT '',
        avatar_url TEXT NOT NULL DEFAULT '',
        accent_color TEXT NOT NULL DEFAULT '#1f5d3a',
        font_scale TEXT NOT NULL DEFAULT 'normal' CHECK (font_scale IN ('small','normal','large','xlarge')),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL DEFAULT ''
      ) STRICT;

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        sort_order INTEGER NOT NULL DEFAULT 0
      ) STRICT;

      CREATE TABLE IF NOT EXISTS products (
        id TEXT PRIMARY KEY,
        category_id TEXT NOT NULL REFERENCES categories(id),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL CHECK (price >= 0),
        old_price INTEGER,
        stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
        image_url TEXT NOT NULL DEFAULT '',
        is_featured INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0,1)),
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        city TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        subtotal INTEGER NOT NULL,
        shipping INTEGER NOT NULL,
        total INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING'
          CHECK (status IN ('PENDING','CONFIRMED','SHIPPED','DELIVERED','CANCELLED')),
        payment_method TEXT NOT NULL DEFAULT 'COD',
        payment_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
        payment_reference TEXT NOT NULL DEFAULT '',
        payment_transaction_id TEXT NOT NULL DEFAULT '',
        payment_expires_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        unit_price INTEGER NOT NULL CHECK (unit_price >= 0)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS store_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS site_content (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK (kind IN ('IMAGE','SECTION')),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        image_url TEXT NOT NULL DEFAULT '',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0,1)),
        created_at TEXT NOT NULL
      ) STRICT;
    `)
    const userColumns = this.db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>
    if (!userColumns.some((column) => column.name === 'account_status')) {
      this.db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE','DISABLED'))")
    }
    if (!userColumns.some((column) => column.name === 'last_seen_at')) {
      this.db.exec("ALTER TABLE users ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''")
    }
    if (!userColumns.some((column) => column.name === 'avatar_url')) {
      this.db.exec("ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''")
    }
    if (!userColumns.some((column) => column.name === 'accent_color')) {
      this.db.exec("ALTER TABLE users ADD COLUMN accent_color TEXT NOT NULL DEFAULT '#1f5d3a'")
    }
    if (!userColumns.some((column) => column.name === 'font_scale')) {
      this.db.exec("ALTER TABLE users ADD COLUMN font_scale TEXT NOT NULL DEFAULT 'normal' CHECK (font_scale IN ('small','normal','large','xlarge'))")
    }
    const sessionColumns = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
    if (!sessionColumns.some((column) => column.name === 'last_seen_at')) {
      this.db.exec("ALTER TABLE sessions ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT ''")
    }
    const productColumns = this.db.prepare('PRAGMA table_info(products)').all() as Array<{ name: string }>
    const existingColumns = new Set(productColumns.map((column) => column.name))
    if (!existingColumns.has('sku')) this.db.exec("ALTER TABLE products ADD COLUMN sku TEXT NOT NULL DEFAULT ''")
    if (!existingColumns.has('barcode')) this.db.exec("ALTER TABLE products ADD COLUMN barcode TEXT NOT NULL DEFAULT ''")
    if (!existingColumns.has('brand')) this.db.exec("ALTER TABLE products ADD COLUMN brand TEXT NOT NULL DEFAULT ''")
    if (!existingColumns.has('unit')) this.db.exec("ALTER TABLE products ADD COLUMN unit TEXT NOT NULL DEFAULT 'قطعة'")
    const orderColumns = new Set((this.db.prepare('PRAGMA table_info(orders)').all() as Array<{ name: string }>).map((column) => column.name))
    if (!orderColumns.has('customer_email')) this.db.exec("ALTER TABLE orders ADD COLUMN customer_email TEXT NOT NULL DEFAULT ''")
    if (!orderColumns.has('payment_status')) this.db.exec("ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED'")
    if (!orderColumns.has('payment_reference')) this.db.exec("ALTER TABLE orders ADD COLUMN payment_reference TEXT NOT NULL DEFAULT ''")
    if (!orderColumns.has('payment_transaction_id')) this.db.exec("ALTER TABLE orders ADD COLUMN payment_transaction_id TEXT NOT NULL DEFAULT ''")
    if (!orderColumns.has('payment_expires_at')) this.db.exec("ALTER TABLE orders ADD COLUMN payment_expires_at TEXT NOT NULL DEFAULT ''")

    const defaults: Record<string, string> = {
      store_name: 'سنتــــر الأزهر',
      store_location: 'شبين القناطر',
      store_whatsapp: '+20 1067920688',
      store_email: 'abdoflaw01@gmail.com',
      store_facebook: 'https://www.facebook.com/alazhar.center.eg/',
      store_instagram: 'https://www.instagram.com/alazhar.center.eg/',
      store_youtube: 'https://www.youtube.com/@AlAzharCenter',
      store_map_url: 'https://maps.app.goo.gl/n78L79Ru6HRC6uP3A',
      store_address: 'الإدارة التعليمية، شارع الإدارة التعليمية والسنترال، مدينة شبين القناطر، محافظة القليوبية 6335231',
      site_accent_color: '#1f5d3a',
      home_kicker: 'أقسام متنوعة تحت سقف واحد',
      home_title: 'سنتر متعدد الأقسام',
      home_emphasis: 'مختص بكل ما يخص الأزهر',
      home_description: 'من الزي الأزهري والكتب إلى مستلزمات العبادة والهدايا والطباعة؛ تعرّف على أقسام مركز الأزهر وتواصل معنا للاستفسار عن المتاح.',
      home_primary_button: 'ادخل إلى المتجر',
      home_secondary_button: 'اكتشف الأقسام',
      home_image_main: '/about-gallery/library-shelves.png',
      home_image_side: '/about-gallery/azhar-clothing.png',
      home_image_bottom: '/about-gallery/tasbeeh.png',
      home_departments_eyebrow: 'أقسام سنتر الأزهر',
      home_departments_title: 'كل ما تحتاجه… في مكان واحد',
      home_departments_description: 'تعرّف على مجالات المركز، واسألنا عن المنتجات والخدمات المتاحة.',
      home_intro_eyebrow: 'أهلاً بك في سنتر الأزهر',
      home_intro_title: 'وجهة واحدة لأقسام أزهرية متعددة',
      home_intro_description: 'يجمع المركز الزي الأزهري والكتب الأزهرية وكتب التجويد والقراءات، إلى جانب الإكسسوارات والهدايا ومستلزمات العبادة وطباعة الإجازات والمتون.',
      home_intro_button: 'اعرف المزيد عن المركز',
      home_intro_image_main: '/about-gallery/educational-book.png',
      home_intro_image_side: '/about-gallery/prayer-accessory.png',
      home_contact_eyebrow: 'تحتاج مساعدة؟',
      home_contact_title: 'اسألنا عن قسم أو خدمة',
      home_contact_description: 'تواصل معنا مباشرة لمعرفة التفاصيل والتوافر.',
      home_contact_button: 'راسلنا على واتساب',
      department_attire_title: 'الزي الأزهري',
      department_attire_description: 'قسم مخصص للزي الأزهري وما يرتبط به من مستلزمات.',
      department_attire_image: '/about-gallery/azhar-clothing.png',
      department_books_title: 'الكتب الأزهرية',
      department_books_description: 'كتب أزهرية ومراجع تعليمية للدارسين والمهتمين.',
      department_books_image: '/about-gallery/educational-book.png',
      department_tajweed_title: 'كتب التجويد والقراءات',
      department_tajweed_description: 'كتب التجويد والقراءات ضمن أقسام المركز.',
      department_tajweed_image: '',
      department_gifts_title: 'الإكسسوارات والهدايا',
      department_gifts_description: 'إكسسوارات وهدايا، ومنها هدايا الحجاج.',
      department_gifts_image: '/about-gallery/prayer-accessory.png',
      department_worship_title: 'مستلزمات العبادة',
      department_worship_description: 'سبح • عطور • مصاحف • مصليات.',
      department_worship_image: '/about-gallery/tasbeeh.png',
      department_printing_title: 'طباعة الإجازات والمتون',
      department_printing_description: 'طباعة الإجازات والمتون ضمن خدمات المركز.',
      department_printing_image: '',
      hero_eyebrow: 'كل ما يخص الأزهر وقراءة القرآن',
      hero_title: 'اختيارات تعينك على',
      hero_emphasis: 'الخير',
      hero_description: 'كتب أزهرية وكتب تجويد ومصاحف وهدايا مختارة بعناية.',
      hero_button: 'تسوق الآن',
      about_eyebrow: 'تعرف علينا',
      about_title: 'سنتــــر الأزهر',
      about_description: 'مكتبة ومستلزمات أزهرية في شبين القناطر، محافظة القليوبية.',
      about_gallery_eyebrow: 'من صور المركز',
      about_gallery_title: 'المكتبة ومقتنياتها',
      about_gallery_description: 'صور منفصلة من الصور التي شاركتها.',
      about_gallery_1_caption: 'مكتبة المركز',
      about_gallery_2_caption: 'كتاب تعليمي',
      about_gallery_3_caption: 'كتاب إسلامي',
      about_gallery_4_caption: 'سبح',
      about_gallery_5_caption: 'مستلزمات متنوعة',
      about_gallery_6_caption: 'زي أزهري',
      about_gallery_1_image: '/about-gallery/library-shelves.png',
      about_gallery_2_image: '/about-gallery/educational-book.png',
      about_gallery_3_image: '/about-gallery/islamic-book.png',
      about_gallery_4_image: '/about-gallery/tasbeeh.png',
      about_gallery_5_image: '/about-gallery/prayer-accessory.png',
      about_gallery_6_image: '/about-gallery/azhar-clothing.png',
      contact_eyebrow: 'نحن هنا لخدمتك',
      contact_title: 'تواصل معنا',
      contact_assistant_description: 'اسأل المساعد الظاهر أسفل الشاشة.',
      contact_orders_description: 'الدفع عند الاستلام ومتابعة حالة الطلب من الحساب.',
      shipping_fee: '35',
      free_shipping_threshold: '500',
      footer_text: 'كتب ومصاحف وهدايا القرآن والأزهر',
      footer_description: 'سنتر متعدد الأقسام مختص بكل ما يخص الأزهر.',
    }
    const insertSetting = this.db.prepare('INSERT OR IGNORE INTO store_settings (key,value) VALUES (?,?)')
    for (const [key, value] of Object.entries(defaults)) insertSetting.run(key, value)
    this.db.prepare("UPDATE store_settings SET value=? WHERE key='store_facebook' AND value='https://www.facebook.com/AlAzhar.Center.eg'")
      .run(defaults.store_facebook)
    this.seed()
    this.seedSiteContent()
  }

  private seedSiteContent() {
    const defaults = [
      ['about-photo-1','IMAGE','مكتبة المركز','/about-gallery/library-shelves.png',10],
      ['about-photo-2','IMAGE','كتاب تعليمي','/about-gallery/educational-book.png',20],
      ['about-photo-3','IMAGE','كتاب إسلامي','/about-gallery/islamic-book.png',30],
      ['about-photo-4','IMAGE','سبح','/about-gallery/tasbeeh.png',40],
      ['about-photo-5','IMAGE','مستلزمات متنوعة','/about-gallery/prayer-accessory.png',50],
      ['about-photo-6','IMAGE','زي أزهري','/about-gallery/azhar-clothing.png',60],
    ] as const
    const getSetting = this.db.prepare('SELECT value FROM store_settings WHERE key=?')
    const insert = this.db.prepare(`
      INSERT OR IGNORE INTO site_content (id,kind,title,description,image_url,sort_order,is_visible,created_at)
      VALUES (?,?,?,'',?,?,1,?)
    `)
    for (let index = 0; index < defaults.length; index += 1) {
      const [id,kind,title,imageUrl,sortOrder] = defaults[index]
      const legacyCaption = getSetting.get(`about_gallery_${index + 1}_caption`) as { value: string } | undefined
      const legacyImage = getSetting.get(`about_gallery_${index + 1}_image`) as { value: string } | undefined
      insert.run(id,kind,legacyCaption?.value || title,legacyImage?.value || imageUrl,sortOrder,new Date().toISOString())
    }
  }

  private seed() {
    const categories = [
      ['category-educational-books', 'الكتب والمراجع التعليمية', 'educational-books', 10],
      ['category-quran-tajweed', 'المصاحف وكتب التجويد والقراءات', 'quran-tajweed', 20],
      ['category-azhar-uniforms', 'الزي الأزهري', 'azhar-uniforms', 30],
      ['category-prayer-supplies', 'مستلزمات الصلاة', 'prayer-supplies', 40],
      ['category-school-supplies', 'الدفاتر والأدوات المدرسية', 'school-supplies', 50],
    ] as const
    const insertCategory = this.db.prepare(
      'INSERT OR IGNORE INTO categories (id,name,slug,sort_order) VALUES (?,?,?,?)',
    )
    for (const category of categories) insertCategory.run(...category)
  }

  onModuleDestroy() {
    this.db.close()
  }
}

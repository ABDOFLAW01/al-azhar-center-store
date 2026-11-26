import { useEffect, useMemo, useState } from 'react'

type FontScale = 'small'|'normal'|'large'|'xlarge'
type User = { id: string; name: string; email: string; phone: string; role: 'CUSTOMER'|'ADMIN'; avatar_url: string; accent_color: string; font_scale: FontScale }
type AdminAccount = {
  id: string; name: string; email: string; phone: string; role: User['role']
  account_status: 'ACTIVE'|'DISABLED'; is_online: number; last_seen_at: string
}
type Category = { id: string; name: string; slug: string }
type Product = {
  id: string; category_id: string; category_name: string; name: string; description: string
  price: number; old_price: number|null; stock: number; image_url: string; is_featured: number
  is_active: number; sku?: string; barcode?: string; brand?: string; unit?: string
}
type CartItem = { product: Product; quantity: number }
type StoreSettings = Record<string, string>
type ChatMessage = { from: 'bot'|'user'; text: string; isError?: boolean }
type SiteContentItem = {
  id: string
  kind: 'IMAGE'|'SECTION'
  title: string
  description: string
  image_url: string
  sort_order: number
  is_visible: number
}
type SiteContentDraft = Omit<SiteContentItem, 'sort_order'>
type PaymentResult = { paymentStatus: 'PENDING'|'PAID'|'FAILED'|'EXPIRED'|'REVIEW'|'UNAVAILABLE'; orderStatus: string }

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

function assetUrl(url: string) {
  if (!url || /^(?:data:|blob:|https?:\/\/|\/\/)/i.test(url)) return url
  return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`
}

const departments = [
  {
    id: 'attire', arTitle: 'الزي الأزهري', enTitle: 'Al-Azhar attire',
    arDescription: 'قسم مخصص للزي الأزهري وما يرتبط به من مستلزمات.',
    enDescription: 'A dedicated section for Al-Azhar attire and related essentials.',
    image: '/about-gallery/azhar-clothing.png', icon: '✦',
    titleKey: 'department_attire_title', descriptionKey: 'department_attire_description', imageKey: 'department_attire_image',
  },
  {
    id: 'books', arTitle: 'الكتب الأزهرية', enTitle: 'Al-Azhar books',
    arDescription: 'كتب أزهرية ومراجع تعليمية للدارسين والمهتمين.',
    enDescription: 'Al-Azhar books and educational references for learners.',
    image: '/about-gallery/educational-book.png', icon: '▤',
    titleKey: 'department_books_title', descriptionKey: 'department_books_description', imageKey: 'department_books_image',
  },
  {
    id: 'tajweed', arTitle: 'كتب التجويد والقراءات', enTitle: 'Tajweed and Qira’at',
    arDescription: 'كتب التجويد والقراءات ضمن أقسام المركز.',
    enDescription: 'Tajweed and Qira’at books as part of the center’s departments.',
    image: '', icon: '۞',
    titleKey: 'department_tajweed_title', descriptionKey: 'department_tajweed_description', imageKey: 'department_tajweed_image',
  },
  {
    id: 'gifts', arTitle: 'الإكسسوارات والهدايا', enTitle: 'Accessories and gifts',
    arDescription: 'إكسسوارات وهدايا، ومنها هدايا الحجاج.',
    enDescription: 'Accessories and gifts, including Hajj gifts.',
    image: '/about-gallery/prayer-accessory.png', icon: '◇',
    titleKey: 'department_gifts_title', descriptionKey: 'department_gifts_description', imageKey: 'department_gifts_image',
  },
  {
    id: 'worship', arTitle: 'مستلزمات العبادة', enTitle: 'Worship essentials',
    arDescription: 'سبح • عطور • مصاحف • مصليات.',
    enDescription: 'Prayer beads • perfumes • Qurans • prayer mats.',
    image: '/about-gallery/tasbeeh.png', icon: '۞',
    titleKey: 'department_worship_title', descriptionKey: 'department_worship_description', imageKey: 'department_worship_image',
  },
  {
    id: 'printing', arTitle: 'طباعة الإجازات والمتون', enTitle: 'Ijazat and Mutun printing',
    arDescription: 'طباعة الإجازات والمتون ضمن خدمات المركز.',
    enDescription: 'Printing Ijazat and Mutun as a center service.',
    image: '', icon: '▧',
    titleKey: 'department_printing_title', descriptionKey: 'department_printing_description', imageKey: 'department_printing_image',
  },
]

async function api(path: string, options: RequestInit = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'حدث خطأ غير متوقع')
  return data
}

const money = (value: number, language: 'ar'|'en' = 'ar') =>
  `${new Intl.NumberFormat(language === 'ar' ? 'ar-EG' : 'en-EG', { maximumFractionDigits: 0 }).format(value)} ${language === 'ar' ? 'ج' : 'EGP'}`
const accentPresets = [
  { color: '#1f5d3a', ar: 'أخضر', en: 'Green' },
  { color: '#2855a0', ar: 'أزرق', en: 'Blue' },
  { color: '#8b3a54', ar: 'عنابي', en: 'Burgundy' },
  { color: '#70408c', ar: 'بنفسجي', en: 'Purple' },
  { color: '#93612d', ar: 'بني', en: 'Brown' },
]

const englishTranslations: Record<string, string> = {
  'أضف أي عدد تحتاجه من الصور أو الأقسام؛ ستظهر العناصر المنشورة في صفحة «عن المركز».': 'Add as many photos or sections as you need. Published items appear on the About page.',
  'إدارة معرض الصور والأقسام': 'Manage the photo gallery and sections',
  'إضافة أو تعديل منتج': 'Add or edit a product',
  'إظهار هذا المحتوى على الموقع': 'Show this content on the website',
  'إلغاء': 'Cancel',
  'إلغاء التعديل': 'Cancel editing',
  'إلغاء العرض': 'Unlist',
  'اختر التصنيف': 'Choose a category',
  'اختر المحافظة': 'Choose a governorate',
  'اسم التصنيف': 'Category name',
  'اسم القسم': 'Section name',
  'اسم المتجر': 'Store name',
  'اسم المنتج': 'Product name',
  'الأكثر طلباً': 'Popular',
  'الإجمالي': 'Total',
  'الاسم بالكامل': 'Full name',
  'الاسم في الرابط': 'URL slug',
  'الباركود': 'Barcode',
  'التحكم في محتوى وتصميم الموقع': 'Manage website content and design',
  'التصنيف': 'Category',
  'التوصيل': 'Delivery',
  'الجيزة': 'Giza',
  'الدفع الإلكتروني الآمن عبر Paymob': 'Secure online payment via Paymob',
  'الدفع عند الاستلام': 'Cash on delivery',
  'الدفع يحتاج إلى مراجعة': 'Payment requires review',
  'السعر': 'Price',
  'السعر القديم': 'Previous price',
  'الشارة الصغيرة': 'Eyebrow text',
  'الصفحة الرئيسية': 'Home page',
  'العميل': 'Customer',
  'العنوان': 'Address',
  'العنوان / وصف الصورة': 'Title / image description',
  'العنوان الرئيسي للتواصل': 'Main contact heading',
  'العنوان الصغير': 'Eyebrow',
  'العنوان بالتفصيل': 'Full address',
  'العودة إلى المتجر': 'Back to store',
  'القاهرة': 'Cairo',
  'القليوبية': 'Qalyubia',
  'الكلمة المميزة': 'Highlighted phrase',
  'الماركة / الناشر': 'Brand / publisher',
  'المجموع الفرعي': 'Subtotal',
  'المحافظة': 'Governorate',
  'المخزون': 'Stock',
  'المكان / الفرع': 'Location / branch',
  'النص السفلي للفوتر': 'Footer bottom text',
  'الوحدة': 'Unit',
  'الوصف': 'Description',
  'بانر المتجر والشحن': 'Store banner and shipping',
  'بعد تأكيد الطلب ستنتقل إلى صفحة Paymob لإتمام الدفع؛ بيانات البطاقة لا تمر عبر متجرنا.': 'After confirming your order, you will be redirected to Paymob to complete payment. Card details never pass through our store.',
  'تعديل': 'Edit',
  'تعذر الاتصال بالخادم': 'Could not connect to the server',
  'حدث خطأ غير متوقع': 'An unexpected error occurred',
  'تعذر الاتصال بالخادم الآن. لا تعِد الدفع؛ أعد تحميل الصفحة بعد قليل للتحقق من الحالة.': 'The server is temporarily unreachable. Do not pay again; reload this page shortly to check the payment status.',
  'تعذر تحديد الطلب': 'Could not identify the order',
  'تغيير شعار المتجر': 'Change store logo',
  'تم استلام الدفع': 'Payment received',
  'تم تأكيد طلبك رقم': 'Your order number is confirmed:',
  'لم يتم تأكيد الدفع للطلب': 'Payment has not been confirmed for order',
  'سلتك ما زالت محفوظة؛ يمكنك المحاولة مجددًا أو اختيار الدفع عند الاستلام.': 'Your cart is still saved. You can try again or choose cash on delivery.',
  'تم الدفع': 'Paid',
  'فشل الدفع': 'Payment failed',
  'انتهت مهلة الدفع': 'Payment expired',
  'مراجعة مطلوبة': 'Review required',
  'تم التسليم': 'Delivered',
  'تم الشحن': 'Shipped',
  'تم تأكيد طلبك': 'Your order is confirmed',
  'جارٍ التحقق من الدفع': 'Verifying payment',
  'حد التوصيل المجاني بالجنيه': 'Free-shipping threshold (EGP)',
  'حذف': 'Delete',
  'حفظ إعدادات الموقع': 'Save website settings',
  'حفظ المنتج': 'Save product',
  'رابط Instagram': 'Instagram URL',
  'رابط YouTube': 'YouTube URL',
  'رابط الصورة': 'Image URL',
  'رابط الصورة (اختياري للقسم)': 'Image URL (optional for sections)',
  'رابط الموقع على الخريطة': 'Map location URL',
  'رابط صفحة فيسبوك': 'Facebook page URL',
  'رسوم التوصيل بالجنيه': 'Delivery fee (EGP)',
  'رفع صورة': 'Upload image',
  'رفع صورة من جهازك': 'Upload a photo from your device',
  'رقم الطلب': 'Order number',
  'رقم الطلب:': 'Order number:',
  'رقم الهاتف': 'Phone number',
  'رقم واتساب': 'WhatsApp number',
  'زر المتجر': 'Store button',
  'زر النبذة': 'About button',
  'زر عرض الأقسام': 'Departments button',
  'زر واتساب': 'WhatsApp button',
  'سلة التسوق': 'Shopping cart',
  'صفحة التواصل': 'Contact page',
  'صفحة عن المركز والصور': 'About page and photos',
  'طريقة الدفع': 'Payment method',
  'طلبك': 'Your order',
  'ظاهر للمتجر': 'Visible in store',
  'عدّل النصوص والصور وبيانات التواصل من هنا؛ التغييرات تظهر على الموقع بعد الحفظ.': 'Edit text, images, and contact details here. Changes appear on the website after saving.',
  'عنوان البانر': 'Banner title',
  'عنوان البانر الصغير': 'Banner eyebrow',
  'عنوان الصفحة': 'Page title',
  'عنوان القسم': 'Section title',
  'عنوان النبذة': 'About section title',
  'عنوان دعوة التواصل': 'Contact callout title',
  'عنوان رئيسي': 'Main title',
  'عنوان مجموعة الصور': 'Gallery group title',
  'عنوان معرض الصور': 'Gallery title',
  'عنوان نبذة المركز': 'About section eyebrow',
  'قد يستغرق تأكيد العملية لحظات. لا تغلق الصفحة.': 'Confirmation may take a few moments. Please keep this page open.',
  'قسم الأقسام في الرئيسية': 'Home page departments section',
  'قيد الانتظار': 'Pending',
  'كلمة زر التسوق': 'Shop button text',
  'كود المخزون SKU': 'Stock keeping unit (SKU)',
  'لا توجد طلبات حتى الآن': 'There are no orders yet',
  'لا توجد منتجات': 'There are no products',
  'لا يوجد محتوى مضاف بعد': 'No content has been added yet',
  'لم يصل رقم الطلب من بوابة الدفع.': 'The payment gateway did not return an order number.',
  'لم يكتمل الدفع': 'Payment was not completed',
  'لوحة الأدمن': 'Admin dashboard',
  'لون الموقع الأساسي': 'Default website color',
  'مؤكد': 'Confirmed',
  'متابعة التسوق': 'Continue shopping',
  'محافظة أخرى': 'Other governorate',
  'مراجعة السلة': 'Review cart',
  'مراجعة مشترياتك': 'Review your purchases',
  'معلوماتك': 'Your information',
  'ملاحظات للطلب': 'Order notes',
  'ملخص الطلب': 'Order summary',
  'ملغي': 'Cancelled',
  'منتج مميز': 'Featured product',
  'نبذة عن المركز': 'About the center',
  'نبذة ونداء التواصل في الرئيسية': 'Home page introduction and contact callout',
  'نص القسم': 'Section text',
  'نص النبذة': 'About text',
  'نص تعريف الفوتر': 'Footer description',
  'هوية المركز والتواصل والفوتر': 'Center identity, contact, and footer',
  'وصف البانر': 'Banner description',
  'وصف القسم': 'Section description',
  'وصف الواجهة الرئيسية': 'Home page description',
  'وصف بطاقة الطلبات': 'Orders card description',
  'وصف بطاقة المساعد': 'Assistant card description',
  'وصف دعوة التواصل': 'Contact callout description',
  'وصف معرض الصور': 'Gallery description',
  'وصل إشعار دفع لا يمكن تأكيده تلقائيًا. احتفظ برقم الطلب وتواصل مع المركز قبل إعادة الدفع.': 'A payment notification could not be confirmed automatically. Keep your order number and contact the center before paying again.',
  '＋ إضافة صورة': '＋ Add photo',
  '＋ إضافة قسم': '＋ Add section',
  'ج': 'EGP',
  'أقسام متنوعة تحت سقف واحد': 'Many departments under one roof',
  'سنتر متعدد الأقسام': 'A multi-department center',
  'مختص بكل ما يخص الأزهر': 'Everything for Al-Azhar',
  'من الزي الأزهري والكتب إلى مستلزمات العبادة والهدايا والطباعة؛ تعرّف على أقسام مركز الأزهر وتواصل معنا للاستفسار عن المتاح.': 'From Al-Azhar attire and books to worship essentials, gifts, and printing. Explore our departments or contact us about availability.',
  'ادخل إلى المتجر': 'Visit the store',
  'اكتشف الأقسام': 'Explore departments',
  'أقسام سنتر الأزهر': 'Al-Azhar Center departments',
  'كل ما تحتاجه… في مكان واحد': 'Everything you need, all in one place',
  'تعرّف على مجالات المركز، واسألنا عن المنتجات والخدمات المتاحة.': 'Explore what the center offers and ask us about available products and services.',
  'أهلاً بك في سنتر الأزهر': 'Welcome to Al-Azhar Center',
  'وجهة واحدة لأقسام أزهرية متعددة': 'One destination for Al-Azhar essentials',
  'يجمع المركز الزي الأزهري والكتب الأزهرية وكتب التجويد والقراءات، إلى جانب الإكسسوارات والهدايا ومستلزمات العبادة وطباعة الإجازات والمتون.': 'Find Al-Azhar attire and books, Tajweed and Qira’at books, accessories and gifts, worship essentials, and Ijazah and Mutun printing.',
  'اعرف المزيد عن المركز': 'Learn more about the center',
  'تحتاج مساعدة؟': 'Need help?',
  'اسألنا عن قسم أو خدمة': 'Ask us about a department or service',
  'تواصل معنا مباشرة لمعرفة التفاصيل والتوافر.': 'Contact us directly for details and availability.',
  'راسلنا على واتساب': 'Message us on WhatsApp',
  'كل ما يخص الأزهر وقراءة القرآن': 'Everything for Al-Azhar and Quran study',
  'تسوق الآن': 'Shop now',
  'تعرف علينا': 'About us',
  'مكتبة ومستلزمات أزهرية في شبين القناطر، محافظة القليوبية.': 'An Al-Azhar bookstore and essentials shop in Shebin El Qanater, Qalyubia.',
  'من صور المركز': 'Photos from the center',
  'المكتبة ومقتنياتها': 'The bookstore and its collection',
  'صور منفصلة من الصور التي شاركتها.': 'Photos shared by the center.',
  'نحن هنا لخدمتك': 'We are here to help',
  'تواصل معنا': 'Contact us',
  'الدفع عند الاستلام ومتابعة حالة الطلب من الحساب.': 'Pay on delivery and track your order from your account.',
  'سنتر متعدد الأقسام مختص بكل ما يخص الأزهر.': 'A multi-department center for everything related to Al-Azhar.',
  'المساعد الذكي غير مفعّل بعد. أضف مفتاح مزوّد الذكاء الاصطناعي إلى إعدادات الخادم.': 'The AI assistant is not configured. Add the provider API key to the server settings.',
  'تعذر الاتصال بمزوّد المساعد الذكي. حاول مرة أخرى لاحقاً.': 'Could not connect to the AI provider. Please try again later.',
  'استغرق رد المساعد وقتاً أطول من المتوقع. جرّب مرة أخرى بعد قليل.': 'The assistant took longer than expected to respond. Please try again shortly.',
  'مفتاح Gemini غير صالح أو لا يملك صلاحية استخدام هذا النموذج.': 'The Gemini API key is invalid or is not authorized to use this model.',
  'رابط API أو اسم النموذج غير متاح. راجع CHATBOT_API_URL وCHATBOT_MODEL.': 'The API URL or model name is unavailable. Check CHATBOT_API_URL and CHATBOT_MODEL.',
  'تم تجاوز حصة Gemini أو لم يتم تفعيل الفوترة للمفتاح.': 'The Gemini quota was exceeded or billing is not enabled for this key.',
  'Gemini رفض إعدادات الطلب. تحقق من اسم النموذج وإعدادات الخادم.': 'Gemini rejected the request settings. Check the model name and server configuration.',
  'لم يُرجع المزوّد إجابة صالحة': 'The provider did not return a valid response.',
  'سنتر الأزهر': 'Al-Azhar Center',
  'المصاحف وكتب التجويد والقراءات': 'Qurans, Tajweed, and Qira’at books',
  'مطلوب للدفع الإلكتروني': 'Required for online payment',
  'شبين القناطر': 'Shebin El Qanater',
  'الإدارة التعليمية، شارع الإدارة التعليمية والسنترال، مدينة شبين القناطر، محافظة القليوبية 6335231': 'Educational Administration Street, near the telephone exchange, Shebin El Qanater, Qalyubia 6335231',
  'السلة فارغة': 'Your cart is empty',
  'أضف بعض المنتجات المختارة ثم عد هنا.': 'Add a few products and come back here.',
  'قائمة المنتجات لم تُضف بعد': 'Products have not been added yet',
  'الصور تحدد أصناف المتجر، لكن السعر والتوافر يحتاجان تأكيدًا. استفسر عنا مباشرة.': 'Photos show the store categories, but prices and availability need confirmation. Contact us to ask.',
  'جرّب اسمًا آخر أو تصنيفًا مختلفًا.': 'Try another name or category.',
  'لا يوجد وصف إضافي.': 'No additional description.',
  'متوفر': 'In stock',
  'قطعة': 'item',
  'نفد المخزون': 'Out of stock',
  'إكسسوارات وهدايا، ومنها هدايا الحجاج.': 'Accessories and gifts, including Hajj gifts.',
  'الزي الأزهري': 'Al-Azhar attire',
  'الكتب الأزهرية': 'Al-Azhar books',
  'كتب التجويد والقراءات': 'Tajweed and Qira’at books',
  'الإكسسوارات والهدايا': 'Accessories and gifts',
  'مستلزمات العبادة': 'Worship essentials',
  'طباعة الإجازات والمتون': 'Ijazah and Mutun printing',
  'قسم مخصص للزي الأزهري وما يرتبط به من مستلزمات.': 'A dedicated section for Al-Azhar attire and related essentials.',
  'كتب أزهرية ومراجع تعليمية للدارسين والمهتمين.': 'Al-Azhar books and educational references for learners and readers.',
  'كتب التجويد والقراءات ضمن أقسام المركز.': 'Tajweed and Qira’at books are available among the center’s departments.',
  'سبح • عطور • مصاحف • مصليات.': 'Prayer beads • Perfumes • Qurans • Prayer mats.',
  'طباعة الإجازات والمتون ضمن خدمات المركز.': 'Ijazah and Mutun printing is one of the center’s services.',
  'هذا المنتج نفد من المخزون': 'This product is out of stock',
  'وصلت للحد المتاح من هذا المنتج': 'You have reached the available stock limit',
  'تمت الإضافة إلى السلة': 'Added to cart',
  'تم تسجيل الطلب بنجاح': 'Your order has been placed',
  'اكتب عنوان المحتوى': 'Enter a content title',
  'ارفع صورة أو أضف رابطها': 'Upload an image or enter its URL',
  'تم تحديث المحتوى': 'Content updated',
  'تمت إضافة المحتوى': 'Content added',
  'تم إظهار المحتوى': 'Content is now visible',
  'تم إخفاء المحتوى': 'Content is now hidden',
  'هل تريد حذف هذا المحتوى نهائيًا؟': 'Permanently delete this content?',
  'تم حذف المحتوى': 'Content deleted',
  'تم تحديث المنتج': 'Product updated',
  'تم إضافة المنتج': 'Product added',
  'هل تريد إلغاء عرض هذا المنتج؟': 'Unlist this product?',
  'تم إلغاء عرض المنتج': 'Product unlisted',
  'تم تحديث التصنيف': 'Category updated',
  'تم إضافة التصنيف': 'Category added',
  'هل تريد حذف التصنيف؟': 'Delete this category?',
  'تم حذف التصنيف': 'Category deleted',
  'تم تعطيل الحساب وإخراج جلساته': 'Account disabled and its sessions signed out',
  'تم إعادة تفعيل الحساب': 'Account reactivated',
  'سيتم حذف الحساب نهائياً. ستظل الطلبات محفوظة بدون ربطها بالحساب. هل تريد المتابعة؟': 'This permanently deletes the account. Its orders will be kept but detached. Continue?',
  'تم حذف الحساب نهائياً': 'Account permanently deleted',
  'تم حفظ إعدادات المتجر': 'Store settings saved',
  'تم رفع شعار المتجر': 'Store logo uploaded',
  'تم تحديث حالة الطلب': 'Order status updated',
  'تم حفظ بيانات حسابك': 'Account details saved',
  'تم تغيير كلمة المرور، وتم تسجيل خروج أجهزتك الأخرى': 'Password changed. Other devices have been signed out.',
  'كلمتا المرور الجديدتان غير متطابقتين': 'The new passwords do not match',
  'اختر صورة بصيغة JPG أو PNG أو WebP': 'Choose a JPG, PNG, or WebP image',
  'حجم الصورة الأصلية يجب ألا يتجاوز 10 ميجابايت': 'The original image must be under 10 MB',
  'حجم الصورة يجب ألا يتجاوز 5 ميجابايت': 'Image size must be under 5 MB',
  'تعذر معالجة الصورة': 'Could not process the image',
  'تعذر ضغط الصورة للحجم المطلوب': 'Could not compress the image enough',
  'تم تحديث الصورة الشخصية': 'Profile photo updated',
  'تم رفع الصورة': 'Image uploaded',
  'تعذرت قراءة الصورة': 'Could not read the image',
  'تم رفع الصورة. احفظ إعدادات الموقع لتثبيتها.': 'Image uploaded. Save the website settings to apply it.',
  'لا توجد منتجات مطابقة': 'No matching products',
  'منتج': 'product',
  'مجاني': 'Free',
  'الطلبات': 'Orders',
  'المنتجات': 'Products',
  'التصنيفات': 'Categories',
  'إعدادات الموقع': 'Website settings',
  'محتوى الصفحات': 'Page content',
  'الحسابات': 'Accounts',
  'حسابي': 'My account',
  'تسجيل الدخول': 'Sign in',
  'إنشاء حساب': 'Create account',
  'الرئيسية': 'Home',
  'عن المتجر': 'About',
  'المتجر': 'Store',
  'تصفح الموقع': 'Explore',
  'حسابك وطلبك': 'Account and orders',
  'إدارة المتجر': 'Store management',
  'لوحة التحكم': 'Dashboard',
  'تسجيل الخروج': 'Sign out',
  'حجم الخط': 'Font size',
  'اختر الحجم المناسب لك، ثم احفظ التعديلات.': 'Choose a comfortable size, then save your changes.',
  'صغير': 'Small',
  'عادي': 'Default',
  'كبير': 'Large',
  'أكبر': 'Largest',
  'لون الموقع': 'Site color',
  'يُحفظ التغيير مع بيانات حسابك.': 'Saved with your account details.',
  'لون مخصص': 'Custom color',
  'الاسم': 'Name',
  'إعداداتك الشخصية': 'Your personal settings',
  'تغيير الصورة': 'Change photo',
  'JPG أو PNG أو WebP': 'JPG, PNG, or WebP',
  'البيانات الشخصية': 'Profile details',
  'حدّث اسمك وتفضيلات ألوان الموقع وحجم الخط.': 'Update your name, site color, and font size preferences.',
  'حفظ التعديلات': 'Save changes',
  'بيانات الحساب': 'Account information',
  'الهاتف': 'Phone',
  'نوع الحساب': 'Account type',
  'مدير': 'Admin',
  'عميل': 'Customer',
  'تغيير كلمة المرور': 'Change password',
  'كلمة المرور الحالية': 'Current password',
  'كلمة المرور الجديدة': 'New password',
  'تأكيد كلمة المرور الجديدة': 'Confirm new password',
  '8 أحرف على الأقل. ستظل مسجلاً على هذا الجهاز فقط.': 'At least 8 characters. This device stays signed in.',
  'تحديث كلمة المرور': 'Update password',
  'البريد الإلكتروني': 'Email',
  'حسابي (${user.name})': 'My account (${user.name})',
  'إغلاق القائمة': 'Close menu',
  'فتح القائمة': 'Open menu',
  'المظهر الداكن': 'Dark mode',
  'المظهر الفاتح': 'Light mode',
  'تغيير المظهر': 'Change appearance',
  'شعار سنتــــر الأزهر': 'Al-Azhar Center logo',
  'من أقسام المركز': 'A center department',
  'تعرّف على المتجر': 'Explore the store',
  'تصفح المنتجات': 'Browse products',
  'تصفح المتجر': 'Browse the store',
  'كل طرق التواصل': 'All contact options',
  'الموقع على الخريطة': 'Map location',
  'عنواننا': 'Our address',
  'افتح الموقع على خرائط Google': 'Open in Google Maps',
  'صفحة المركز': 'Center page',
  'اسأل المساعد الظاهر أسفل الشاشة.': 'Ask the assistant at the bottom of the screen.',
  'واتساب': 'WhatsApp',
  'فيسبوك': 'Facebook',
  'جميع الحقوق محفوظة.': 'All rights reserved.',
  'الزي الأزهري • الكتب • الهدايا • مستلزمات العبادة': 'Al-Azhar attire • Books • Gifts • Worship essentials',
  'الاسم الكامل': 'Full name',
  'كلمة المرور': 'Password',
  'دخول': 'Sign in',
  'ليس لديك حساب؟': 'Don’t have an account?',
  'لديك حساب؟': 'Already have an account?',
  'مساعد سنتر الأزهر': 'Al-Azhar Center assistant',
  'اسأل عن أقسام المركز': 'Ask about our departments',
  'إغلاق المساعد': 'Close assistant',
  'أهلاً بك. كيف يمكنني مساعدتك؟': 'Welcome. How can I help you?',
  'ابدأ بسؤال': 'Try asking',
  'ما أقسام المركز؟': 'What departments do you have?',
  'هل توجد كتب تجويد وقراءات؟': 'Do you have Tajweed and Qira’at books?',
  'كيف أتواصل معكم؟': 'How can I contact you?',
  'جارٍ الرد...': 'Replying...',
  'اكتب سؤالك هنا...': 'Write your question here...',
  'إرسال الرسالة': 'Send message',
  'فتح مساعد سنتر الأزهر': 'Open the Al-Azhar Center assistant',
  'السلة': 'Cart',
  'خدمة Google Gemini غير متاحة مؤقتًا': 'Google Gemini is temporarily unavailable',
  'أخطأ مزوّد المساعد الذكي': 'The AI provider returned an error',
  'تعذر الاتصال بالخادم:': 'Could not connect to the server:',
  'بدون تصنيف': 'Uncategorized',
  'مخزون': 'Stock',
  'ظاهر': 'Visible',
  'مخفي': 'Hidden',
  'الدفع الإلكتروني — Paymob': 'Online payment — Paymob',
  'المتابعة إلى الدفع الإلكتروني': 'Continue to online payment',
  'تأكيد الطلب والدفع عند الاستلام': 'Place order with cash on delivery',
  'تعديل تصنيف': 'Edit category',
  'إضافة تصنيف': 'Add category',
  'حفظ التعديل': 'Save changes',
  'إضافة التصنيف': 'Add category',
  'تعديل المحتوى': 'Edit content',
  'إضافة صورة إلى المعرض': 'Add image to gallery',
  'إضافة قسم جديد': 'Add new section',
  'إضافة إلى الموقع': 'Add to website',
  'صورة معرض': 'Gallery image',
  'قسم محتوى': 'Content section',
  'إخفاء': 'Hide',
  'إظهار': 'Show',
  'صورة رئيسية': 'Main image',
  'الصورة الرئيسية': 'Main image',
  'الصورة الجانبية': 'Side image',
  'الصورة السفلية': 'Bottom image',
  'صورة النبذة الأولى': 'First introduction image',
  'صورة النبذة الثانية': 'Second introduction image',
  'صورة الزي الأزهري': 'Al-Azhar attire image',
  'صورة الكتب الأزهرية': 'Al-Azhar books image',
  'صورة كتب التجويد والقراءات': 'Tajweed and Qira’at books image',
  'صورة الإكسسوارات والهدايا': 'Accessories and gifts image',
  'صورة مستلزمات العبادة': 'Worship essentials image',
  'صورة طباعة الإجازات والمتون': 'Ijazah and Mutun printing image',
}

function englishText(value: string) {
  const key = value.trim().replace(/\s+/g, ' ')
  return englishTranslations[key]
}

function localizedText(language: 'ar'|'en', value: string) {
  if (language === 'ar') return value
  const key = value.trim().replace(/\s+/g, ' ')
  const status = key.match(/^خدمة Google Gemini غير متاحة مؤقتًا \(HTTP (\d+)\)\. جرّب إرسال الرسالة مرة أخرى بعد قليل\.$/)
  const translated = status
    ? `Google Gemini is temporarily unavailable (HTTP ${status[1]}). Please try sending your message again shortly.`
    : englishTranslations[key] || key
  const leadingSpace = /^\s*\n/.test(value) ? '' : /^\s/.test(value) ? ' ' : ''
  const trailingSpace = /\n\s*$/.test(value) ? '' : /\s$/.test(value) ? ' ' : ''
  return `${leadingSpace}${translated}${trailingSpace}`
}

function formatLastSeen(value: string, language: 'ar'|'en') {
  if (!value) return language === 'ar' ? 'لم يسجل الدخول بعد' : 'Has not signed in yet'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return language === 'ar' ? 'وقت آخر ظهور غير متاح' : 'Last seen time unavailable'

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  const unit: Intl.RelativeTimeFormatUnit = elapsedSeconds < 60 ? 'second'
    : elapsedSeconds < 3600 ? 'minute'
      : elapsedSeconds < 86400 ? 'hour'
        : 'day'
  const divisor = unit === 'second' ? 1 : unit === 'minute' ? 60 : unit === 'hour' ? 3600 : 86400
  const amount = Math.floor(elapsedSeconds / divisor)
  const relative = new Intl.RelativeTimeFormat(language === 'ar' ? 'ar-EG' : 'en-US', { numeric: 'auto' })
  return `${language === 'ar' ? 'آخر ظهور' : 'Last seen'} ${relative.format(-amount, unit)}`
}

function foregroundFor(hexColor: string) {
  const channels = [1, 3, 5].map((index) => parseInt(hexColor.slice(index, index + 2), 16) / 255)
  const [red, green, blue] = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.42 ? '#163128' : '#ffffff'
}

function storedAccentColor() {
  const color = localStorage.getItem('al-azhar-accent-color')
  return color && /^#[0-9a-f]{6}$/i.test(color) ? color : '#1f5d3a'
}

function storedFontScale(): FontScale {
  const scale = localStorage.getItem('al-azhar-font-scale')
  return scale === 'small' || scale === 'large' || scale === 'xlarge' ? scale : 'normal'
}

function contentText(language: 'ar'|'en', settings: StoreSettings, key: string, fallback: string) {
  if (language === 'ar') return settings[key] || fallback
  return englishText(settings[key] || '') || englishText(fallback) || fallback
}

function ProductArt({ product, large = false, language = 'ar' }: { product: Product; large?: boolean; language?: 'ar'|'en' }) {
  if (product.image_url) return <img className={large ? 'product-art large' : 'product-art'} src={assetUrl(product.image_url)} alt={localizedText(language, product.name)} />
  const icon = product.category_name.includes('القرآن') ? '📖'
    : product.category_name.includes('التجويد') ? '📚'
    : product.category_name.includes('السبح') ? '📿'
    : product.category_name.includes('الحج') ? '🎁'
    : '📗'
  return <div className={large ? 'product-art emblem large' : 'product-art emblem'}><span>{icon}</span></div>
}

function PasswordField({ name, language, autoComplete, minLength }: {
  name: string
  language: 'ar'|'en'
  autoComplete?: string
  minLength?: number
}) {
  const [visible, setVisible] = useState(false)
  const label = language === 'ar'
    ? (visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور')
    : (visible ? 'Hide password' : 'Show password')

  return (
    <span className="password-input-wrap">
      <input name={name} type={visible ? 'text' : 'password'} autoComplete={autoComplete} minLength={minLength} required />
      <button className="password-visibility-button" type="button" onClick={() => setVisible((current) => !current)} aria-label={label} aria-pressed={visible} title={label}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </span>
  )
}

export default function App() {
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [user, setUser] = useState<User|null>(null)
  const [profileName, setProfileName] = useState('')
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('al-azhar-cart') || '[]') } catch { return [] }
  })
  const [view, setView] = useState<'home'|'shop'|'cart'|'checkout'|'account'|'admin'|'product'|'about'|'contact'|'payment-result'>('home')
  const [authMode, setAuthMode] = useState<'login'|'register'|null>(null)
  const [toast, setToast] = useState('')
  const [orderId, setOrderId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'COD'|'PAYMOB'>('COD')
  const [paymobEnabled, setPaymobEnabled] = useState(false)
  const [paymentResultOrderId, setPaymentResultOrderId] = useState('')
  const [paymentResult, setPaymentResult] = useState<PaymentResult|null>(null)
  const [adminOrders, setAdminOrders] = useState<any[]>([])
  const [adminProducts, setAdminProducts] = useState<Product[]>([])
  const [storeSettings, setStoreSettings] = useState<StoreSettings>({})
  const [adminTab, setAdminTab] = useState<'orders'|'products'|'categories'|'settings'|'content'|'users'>('orders')
  const [editingCategoryId, setEditingCategoryId] = useState('')
  const [adminUsers, setAdminUsers] = useState<AdminAccount[]>([])
  const [siteContent, setSiteContent] = useState<SiteContentItem[]>([])
  const [contentDraft, setContentDraft] = useState<SiteContentDraft|null>(null)
  const [media, setMedia] = useState<Array<{name:string;url:string}>>([])
  const [language, setLanguage] = useState<'ar'|'en'>(() => (localStorage.getItem('al-azhar-language') as 'ar'|'en') || 'ar')
  const [theme, setTheme] = useState<'light'|'dark'>(() => (localStorage.getItem('al-azhar-theme') as 'light'|'dark') || 'light')
  const [accentColor, setAccentColor] = useState(storedAccentColor)
  const [accentColorDirty, setAccentColorDirty] = useState(false)
  const [fontScale, setFontScale] = useState<FontScale>(storedFontScale)
  const [selectedProduct, setSelectedProduct] = useState<Product|null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { from:'bot', text:language === 'ar' ? 'أهلاً بك. كيف يمكنني مساعدتك؟' : 'Welcome. How can I help you?' },
  ])

  const copy = {
    home: language === 'ar' ? 'الرئيسية' : 'Home',
    login: language === 'ar' ? 'تسجيل الدخول' : 'Sign in',
    register: language === 'ar' ? 'إنشاء حساب' : 'Create account',
    cart: language === 'ar' ? 'السلة' : 'Cart',
    search: language === 'ar' ? 'ابحث عن منتج أو تصنيف...' : 'Search products or categories...',
    about: language === 'ar' ? 'عن المتجر' : 'About',
    contact: language === 'ar' ? 'تواصل معنا' : 'Contact',
    shop: language === 'ar' ? 'تصفح الآن' : 'Shop now',
    catalog: language === 'ar' ? 'التصنيفات' : 'Categories',
    all: language === 'ar' ? 'كل المنتجات' : 'All products',
    noResults: language === 'ar' ? 'لا توجد منتجات مطابقة' : 'No matching products',
    add: language === 'ar' ? 'أضف للسلة' : 'Add to cart',
    soldOut: language === 'ar' ? 'نفد المخزون' : 'Out of stock',
    featured: language === 'ar' ? 'الأكثر طلباً' : 'Popular',
  } as const
  const tx = (value: string) => localizedText(language, value)
  const whatsappQuestion = encodeURIComponent(language === 'ar'
    ? 'السلام عليكم، أريد الاستفسار عن المنتجات والأسعار المتاحة.'
    : 'Hello, I would like to ask about available products and prices.')
  const whatsappNumber = (storeSettings.store_whatsapp || '+20 1067920688').replace(/\D/g, '') || '201067920688'
  const whatsappUrl = `https://wa.me/${whatsappNumber}`
  const storeEmail = storeSettings.store_email || 'abdoflaw01@gmail.com'
  const storeFacebook = storeSettings.store_facebook || 'https://www.facebook.com/alazhar.center.eg/'
  const storeInstagram = storeSettings.store_instagram || 'https://www.instagram.com/alazhar.center.eg/'
  const storeYoutube = storeSettings.store_youtube || 'https://www.youtube.com/@AlAzharCenter'
  const storeMapUrl = storeSettings.store_map_url || 'https://maps.app.goo.gl/n78L79Ru6HRC6uP3A'
  const storeAddress = storeSettings.store_address || 'الإدارة التعليمية، شارع الإدارة التعليمية والسنترال، مدينة شبين القناطر، محافظة القليوبية 6335231'
  const siteAccentColor = /^#[0-9a-f]{6}$/i.test(storeSettings.site_accent_color || '') ? storeSettings.site_accent_color : '#1f5d3a'
  const hasSavedPersonalAccent = user && user.accent_color.toLowerCase() !== '#1f5d3a'
  const appliedAccentColor = user && (accentColorDirty || hasSavedPersonalAccent) ? accentColor : siteAccentColor

  useEffect(() => {
    Promise.all([api('/api/categories'), api('/api/products'), api('/api/auth/me'), api('/api/settings'), api('/api/site-sections'), api('/api/payments/options')])
      .then(([cats, items, session, settings, content, paymentOptions]) => { setCategories(cats); setProducts(items); setUser(session.user); setStoreSettings(settings); setSiteContent(content); setPaymobEnabled(paymentOptions.methods.includes('PAYMOB')) })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : 'Unknown error'
        notify(`${localizedText(language, 'تعذر الاتصال بالخادم')}: ${detail}`)
      })
  }, [])

  useEffect(() => {
    if (!user) return
    let active = true
    const heartbeat = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        await api('/api/auth/presence', { method: 'POST' })
      } catch (error) {
        if (!active) return
        if (error instanceof Error && error.message === 'سجل الدخول أولاً') {
          setUser(null)
          return
        }
        console.error('Unable to update account presence', error)
      }
    }
    const onVisibilityChange = () => { void heartbeat() }
    void heartbeat()
    const interval = window.setInterval(() => { void heartbeat() }, 45_000)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [user?.id])

  useEffect(() => {
    if (user?.role !== 'ADMIN' || adminTab !== 'users') return
    let active = true
    let errorReported = false
    const refreshUsers = async () => {
      try {
        const users = await api('/api/admin/users')
        if (active) setAdminUsers(users)
        errorReported = false
      } catch (error) {
        if (!active) return
        console.error('Unable to refresh account presence', error)
        if (!errorReported) {
          notify(error instanceof Error ? error.message : 'تعذر تحديث حالة الحسابات')
          errorReported = true
        }
      }
    }
    void refreshUsers()
    const interval = window.setInterval(() => { void refreshUsers() }, 30_000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [user?.id, user?.role, adminTab])

  useEffect(() => localStorage.setItem('al-azhar-cart', JSON.stringify(cart)), [cart])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.fontScale = fontScale
    document.documentElement.lang = language
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.style.setProperty('--brand', appliedAccentColor)
    document.documentElement.style.setProperty('--brand-foreground', foregroundFor(appliedAccentColor))
    document.documentElement.style.setProperty('--font-scale', fontScale === 'small' ? '0.9' : fontScale === 'large' ? '1.1' : fontScale === 'xlarge' ? '1.2' : '1')
    localStorage.setItem('al-azhar-theme', theme)
    localStorage.setItem('al-azhar-language', language)
    localStorage.setItem('al-azhar-accent-color', accentColor)
    localStorage.setItem('al-azhar-font-scale', fontScale)
  }, [theme, language, accentColor, appliedAccentColor, fontScale])

  useEffect(() => {
    if (user) {
      setProfileName(user.name)
      if (/^#[0-9a-f]{6}$/i.test(user.accent_color)) setAccentColor(user.accent_color)
      setFontScale(user.font_scale || 'normal')
    }
  }, [user?.id, user?.name, user?.accent_color, user?.font_scale])

  useEffect(() => {
    setChatMessages([{ from:'bot', text: language === 'ar' ? 'أهلاً بك. كيف يمكنني مساعدتك؟' : 'Welcome. How can I help you?' }])
  }, [language])

  useEffect(() => {
    const readRoute = () => {
      const path = window.location.pathname
      if (path === '/contact') setView('contact')
      else if (path === '/about') setView('about')
      else if (path === '/shop') setView('shop')
      else if (path === '/payment-result') {
        const parameters = new URLSearchParams(window.location.search)
        setPaymentResultOrderId(parameters.get('order_ref') || parameters.get('merchant_order_id') || parameters.get('order_id') || '')
        setPaymentResult(null)
        setView('payment-result')
      }
      else if (path.startsWith('/product/')) {
        const id = decodeURIComponent(path.split('/')[2] || '')
        if (id) {
          api(`/api/products/${id}`).then((product) => { setSelectedProduct(product); setView('product') }).catch(() => { setView('shop'); window.history.replaceState({},'','/shop') })
        }
      } else setView('home')
    }
    readRoute()
    window.addEventListener('popstate', readRoute)
    return () => window.removeEventListener('popstate', readRoute)
  }, [])

  useEffect(() => {
    if (view !== 'payment-result' || !paymentResultOrderId) return
    let active = true
    let attempts = 0
    let timer: number | undefined
    const checkStatus = async () => {
      try {
        const status = await api(`/api/payments/status/${encodeURIComponent(paymentResultOrderId)}`)
        if (!active) return
        setPaymentResult(status)
        if (status.paymentStatus === 'PAID') {
          setCart([])
          return
        }
        if (['FAILED','EXPIRED','REVIEW'].includes(status.paymentStatus)) return
      } catch {
        if (!active) return
        setPaymentResult({ paymentStatus: 'UNAVAILABLE', orderStatus: '' })
      }
      attempts += 1
      if (attempts < 30) timer = window.setTimeout(checkStatus, 2000)
    }
    void checkStatus()
    return () => {
      active = false
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [view, paymentResultOrderId])

  const filtered = useMemo(() => products.filter((product) => {
    const categoryMatch = activeCategory === 'all' || product.category_id === activeCategory
    const searchMatch = !search.trim() || `${product.name} ${product.description}`.toLowerCase().includes(search.toLowerCase())
    return categoryMatch && searchMatch
  }), [products, activeCategory, search])

  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const freeShippingThreshold = Number(storeSettings.free_shipping_threshold || 500)
  const shippingFee = Number(storeSettings.shipping_fee || 35)
  const shipping = subtotal === 0 || subtotal >= freeShippingThreshold ? 0 : shippingFee
  const visibleGalleryItems = siteContent.filter((item) => item.kind === 'IMAGE' && item.is_visible === 1)
  const visibleAboutSections = siteContent.filter((item) => item.kind === 'SECTION' && item.is_visible === 1)

  function notify(message: string) {
    setToast(localizedText(language, message))
    window.setTimeout(() => setToast(''), 3000)
  }

  function navigate(path: string, nextView: typeof view) {
    window.history.pushState({}, '', path)
    setView(nextView)
    setMobileMenuOpen(false)
  }

  function openShop() {
    setActiveCategory('all')
    setSearch('')
    navigate('/shop', 'shop')
  }

  async function openProduct(product: Product) {
    try {
      const full = await api(`/api/products/${product.id}`)
      setSelectedProduct(full)
      navigate(`/product/${encodeURIComponent(product.id)}`, 'product')
    } catch (error) { notify((error as Error).message) }
  }

  async function sendChat(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const message = String(form.get('message') || '').trim()
    event.currentTarget.reset()
    await askChat(message)
  }

  async function askChat(message: string) {
    if (chatBusy || !message.trim()) return
    message = message.trim()
    setChatMessages((current) => [...current, { from:'user', text:message }])
    setChatBusy(true)
    try {
      const response = await api('/api/chatbot/message', { method:'POST', body:JSON.stringify({ message }) })
      setChatMessages((current) => [...current, { from:'bot', text:response.reply }])
    } catch (error) {
      setChatMessages((current) => [...current, { from:'bot', text:localizedText(language, (error as Error).message), isError:true }])
    } finally { setChatBusy(false) }
  }

  function addToCart(product: Product) {
    if (product.stock < 1) return notify(tx('هذا المنتج نفد من المخزون'))
    setCart((current) => {
      const existing = current.find((item) => item.product.id === product.id)
      if (existing) {
        if (existing.quantity >= product.stock) { notify(tx('وصلت للحد المتاح من هذا المنتج')); return current }
        return current.map((item) => item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item)
      }
      return [...current, { product, quantity: 1 }]
    })
    notify('تمت الإضافة إلى السلة')
  }

  function changeQuantity(id: string, quantity: number) {
    setCart((current) => current.flatMap((item) => {
      if (item.product.id !== id) return [item]
      const next = Math.min(Math.max(quantity, 1), item.product.stock)
      return next ? [{ ...item, quantity: next }] : []
    }))
  }

  async function submitLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: form.get('email'), password: form.get('password') }) })
      setUser(result.user); setAuthMode(null); notify(language === 'ar' ? `مرحباً ${result.user.name}` : `Welcome, ${result.user.name}`)
    } catch (error) { notify((error as Error).message) }
  }

  async function submitRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const result = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({
        name: form.get('name'), email: form.get('email'), phone: form.get('phone'), password: form.get('password'),
      }) })
      setUser(result.user); setAuthMode(null); notify(language === 'ar' ? `تم إنشاء حسابك، مرحباً ${result.user.name}` : `Your account is ready, ${result.user.name}`)
    } catch (error) { notify((error as Error).message) }
  }

  async function submitOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    try {
      const order = await api('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          customerName: form.get('name'), phone: form.get('phone'), address: form.get('address'), city: form.get('city'),
          customerEmail: form.get('email'), paymentMethod,
          notes: form.get('notes'), items: cart.map((item) => ({ id: item.product.id, quantity: item.quantity })),
        }),
      })
      if (order.checkoutUrl) {
        window.location.assign(order.checkoutUrl)
        return
      }
      setOrderId(order.id); setCart([]); navigate('/shop','shop'); notify('تم تسجيل الطلب بنجاح')
    } catch (error) { notify((error as Error).message) }
  }

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' })
    setUser(null); navigate('/shop','shop')
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    try {
      const result = await api('/api/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify({ name: profileName, accentColor, fontScale }),
      })
      setUser(result.user)
      setAccentColorDirty(false)
      notify(language === 'ar' ? 'تم حفظ بيانات حسابك' : 'Account details saved')
    } catch (error) { notify((error as Error).message) }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const currentPassword = String(values.get('currentPassword') || '')
    const newPassword = String(values.get('newPassword') || '')
    const confirmPassword = String(values.get('confirmPassword') || '')
    if (newPassword !== confirmPassword) {
      notify(language === 'ar' ? 'كلمتا المرور الجديدتان غير متطابقتين' : 'New passwords do not match')
      return
    }
    try {
      await api('/api/auth/password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      form.reset()
      notify(language === 'ar' ? 'تم تغيير كلمة المرور، وتم تسجيل خروج أجهزتك الأخرى' : 'Password changed; other sessions were signed out')
    } catch (error) { notify((error as Error).message) }
  }

  async function uploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      notify(language === 'ar' ? 'اختر صورة بصيغة JPG أو PNG أو WebP' : 'Choose a JPG, PNG, or WebP image')
      input.value = ''
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      notify(language === 'ar' ? 'حجم الصورة الأصلية يجب ألا يتجاوز 10 ميجابايت' : 'The original image must be under 10 MB')
      input.value = ''
      return
    }

    let bitmap: ImageBitmap | undefined
    try {
      bitmap = await createImageBitmap(file)
      let dataUrl = ''
      for (const maxSide of [320, 256, 192]) {
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale))
        canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const context = canvas.getContext('2d')
        if (!context) throw new Error(language === 'ar' ? 'تعذر معالجة الصورة' : 'Could not process the image')
        context.fillStyle = '#ffffff'
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        dataUrl = canvas.toDataURL('image/jpeg', 0.78)
        if (dataUrl.length <= 80 * 1024) break
      }
      if (dataUrl.length > 80 * 1024) {
        notify(language === 'ar' ? 'تعذر ضغط الصورة للحجم المطلوب' : 'Could not compress the image enough')
        return
      }
      const result = await api('/api/auth/avatar', { method: 'POST', body: JSON.stringify({ dataUrl }) })
      setUser(result.user)
      notify(language === 'ar' ? 'تم تحديث الصورة الشخصية' : 'Profile photo updated')
    } catch (error) { notify((error as Error).message) }
    finally {
      bitmap?.close()
      input.value = ''
    }
  }

  async function uploadManagedContentImage(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      notify(language === 'ar' ? 'اختر صورة بصيغة JPG أو PNG أو WebP' : 'Choose a JPG, PNG, or WebP image')
      input.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      notify(language === 'ar' ? 'حجم الصورة يجب ألا يتجاوز 5 ميجابايت' : 'Image size must be under 5 MB')
      input.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const result = await api('/api/admin/content-image', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result }) })
        setContentDraft((current) => current ? { ...current, image_url: result.imageUrl } : current)
        notify(language === 'ar' ? 'تم رفع الصورة' : 'Image uploaded')
      } catch (error) { notify((error as Error).message) }
    }
    reader.onerror = () => notify(language === 'ar' ? 'تعذرت قراءة الصورة' : 'Could not read the image')
    reader.readAsDataURL(file)
    input.value = ''
  }

  function startContentDraft(kind: SiteContentItem['kind']) {
    setContentDraft({ id: '', kind, title: '', description: '', image_url: '', is_visible: 1 })
  }

  async function saveSiteContent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!contentDraft) return
    if (!contentDraft.title.trim()) return notify('اكتب عنوان المحتوى')
    if (contentDraft.kind === 'IMAGE' && !contentDraft.image_url.trim()) return notify('ارفع صورة أو أضف رابطها')
    try {
      const body = JSON.stringify({
        kind: contentDraft.kind,
        title: contentDraft.title,
        description: contentDraft.description,
        imageUrl: contentDraft.image_url,
        isVisible: contentDraft.is_visible === 1,
      })
      const saved = contentDraft.id
        ? await api(`/api/admin/site-sections/${contentDraft.id}`, { method: 'PATCH', body })
        : await api('/api/admin/site-sections', { method: 'POST', body })
      setSiteContent((current) => {
        const next = contentDraft.id
          ? current.map((item) => item.id === saved.id ? saved : item)
          : [...current, saved]
        return next.sort((a, b) => a.sort_order - b.sort_order)
      })
      setContentDraft(null)
      notify(contentDraft.id ? 'تم تحديث المحتوى' : 'تمت إضافة المحتوى')
    } catch (error) { notify((error as Error).message) }
  }

  async function toggleSiteContent(item: SiteContentItem) {
    try {
      const updated = await api(`/api/admin/site-sections/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isVisible: item.is_visible !== 1 }),
      })
      setSiteContent((current) => current.map((entry) => entry.id === item.id ? updated : entry))
      notify(updated.is_visible === 1 ? 'تم إظهار المحتوى' : 'تم إخفاء المحتوى')
    } catch (error) { notify((error as Error).message) }
  }

  async function deleteSiteContent(id: string) {
    if (!window.confirm('هل تريد حذف هذا المحتوى نهائيًا؟')) return
    try {
      await api(`/api/admin/site-sections/${id}`, { method: 'DELETE' })
      setSiteContent((current) => current.filter((item) => item.id !== id))
      if (contentDraft?.id === id) setContentDraft(null)
      notify('تم حذف المحتوى')
    } catch (error) { notify((error as Error).message) }
  }

  async function openAdmin() {
    setView('admin')
    setMobileMenuOpen(false)
    try {
      const [orders, products, users, mediaFiles, siteItems] = await Promise.all([
        api('/api/admin/orders'), api('/api/admin/products'), api('/api/admin/users'), api('/api/admin/media'), api('/api/admin/site-sections'),
      ])
      setAdminOrders(orders); setAdminProducts(products); setAdminUsers(users); setMedia(mediaFiles); setSiteContent(siteItems)
    } catch (error) { notify((error as Error).message) }
  }

  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const id = String(form.get('id') || '')
    const body = {
      name: form.get('name'), categoryId: form.get('categoryId'), description: form.get('description'),
      price: Number(form.get('price')), oldPrice: form.get('oldPrice') ? Number(form.get('oldPrice')) : null,
      stock: Number(form.get('stock')), sku: form.get('sku'), barcode: form.get('barcode'), brand: form.get('brand'),
      unit: form.get('unit'), imageUrl: form.get('imageUrl'), featured: form.get('featured') === 'on',
      isActive: form.get('isActive') === 'on',
    }
    try {
      const saved = id
        ? await api(`/api/admin/products/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api('/api/admin/products', { method: 'POST', body: JSON.stringify(body) })
      setAdminProducts((current) => id ? current.map((product) => product.id === id ? saved : product) : [saved, ...current])
      setProducts((current) => saved.is_active ? [saved, ...current.filter((product) => product.id !== saved.id)] : current.filter((product) => product.id !== saved.id))
      formElement.reset()
      notify(id ? 'تم تحديث المنتج' : 'تم إضافة المنتج')
    } catch (error) { notify((error as Error).message) }
  }

  async function deleteProduct(id: string) {
    if (!window.confirm('هل تريد إلغاء عرض هذا المنتج؟')) return
    try {
      await api(`/api/admin/products/${id}`, { method: 'DELETE' })
      setAdminProducts((current) => current.map((product) => product.id === id ? { ...product, is_active: 0 } : product))
      setProducts((current) => current.filter((product) => product.id !== id))
      notify('تم إلغاء عرض المنتج')
    } catch (error) { notify((error as Error).message) }
  }

  async function createCategory(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formElement = event.currentTarget
    const form = new FormData(formElement)
    const id = String(form.get('id') || '')
    try {
      const body = JSON.stringify({ name: form.get('name'), slug: form.get('slug') })
      const category = id
        ? await api(`/api/admin/categories/${id}`, { method: 'PATCH', body })
        : await api('/api/admin/categories', { method: 'POST', body })
      setCategories((current) => id ? current.map((item) => item.id === id ? category : item) : [...current, category])
      formElement.reset()
      setEditingCategoryId('')
      notify(id ? 'تم تحديث التصنيف' : 'تم إضافة التصنيف')
    } catch (error) { notify((error as Error).message) }
  }

  async function deleteCategory(id: string) {
    if (!window.confirm('هل تريد حذف التصنيف؟')) return
    try {
      await api(`/api/admin/categories/${id}`, { method: 'DELETE' })
      setCategories((current) => current.filter((category) => category.id !== id))
      notify('تم حذف التصنيف')
    } catch (error) { notify((error as Error).message) }
  }

  async function setAccountStatus(id: string, status: 'ACTIVE'|'DISABLED') {
    try {
      const updated = await api(`/api/admin/users/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      })
      setAdminUsers((current) => current.map((account) => account.id === id ? updated : account))
      notify(status === 'DISABLED' ? 'تم تعطيل الحساب وإخراج جلساته' : 'تم إعادة تفعيل الحساب')
    } catch (error) { notify((error as Error).message) }
  }

  async function permanentlyDeleteAccount(id: string) {
    if (!window.confirm('سيتم حذف الحساب نهائياً. ستظل الطلبات محفوظة بدون ربطها بالحساب. هل تريد المتابعة؟')) return
    try {
      await api(`/api/admin/users/${id}`, { method: 'DELETE' })
      setAdminUsers((current) => current.filter((account) => account.id !== id))
      notify('تم حذف الحساب نهائياً')
    } catch (error) { notify((error as Error).message) }
  }

  async function updateStoreSettings(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const body = Object.fromEntries(Array.from(form.entries()).map(([key, value]) => [key, String(value)]))
    try {
      const settings = await api('/api/admin/settings', { method: 'PATCH', body: JSON.stringify(body) })
      setStoreSettings(settings)
      notify('تم حفظ إعدادات المتجر')
    } catch (error) { notify((error as Error).message) }
  }

  async function uploadImage(event: React.ChangeEvent<HTMLInputElement>, target: 'product'|'logo') {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 5 * 1024 * 1024) return notify(tx('حجم الصورة يجب ألا يتجاوز 5 ميجابايت'))
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const endpoint = target === 'logo' ? '/api/admin/logo' : '/api/admin/product-image'
        const result = await api(endpoint, { method: 'POST', body: JSON.stringify({ dataUrl: reader.result }) })
        if (target === 'logo') {
          setStoreSettings((current) => ({ ...current, logo_url: result.imageUrl }))
          notify('تم رفع شعار المتجر')
        } else {
          const input = document.querySelector<HTMLInputElement>('input[name="imageUrl"]')
          if (input) input.value = result.imageUrl
        }
      } catch (error) { notify((error as Error).message) }
    }
    reader.readAsDataURL(file)
  }

  async function uploadContentImage(event: React.ChangeEvent<HTMLInputElement>, settingKey: string) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) {
      notify(language === 'ar' ? 'اختر صورة بصيغة JPG أو PNG أو WebP' : 'Choose a JPG, PNG, or WebP image')
      input.value = ''
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      notify(language === 'ar' ? 'حجم الصورة يجب ألا يتجاوز 5 ميجابايت' : 'Image size must be under 5 MB')
      input.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const result = await api('/api/admin/content-image', { method: 'POST', body: JSON.stringify({ dataUrl: reader.result }) })
        const urlInput = input.closest('form')?.elements.namedItem(settingKey)
        if (urlInput instanceof HTMLInputElement) urlInput.value = result.imageUrl
        setStoreSettings((current) => ({ ...current, [settingKey]: result.imageUrl }))
        notify(language === 'ar' ? 'تم رفع الصورة. احفظ إعدادات الموقع لتثبيتها.' : 'Image uploaded. Save site settings to apply it.')
      } catch (error) { notify((error as Error).message) }
    }
    reader.onerror = () => notify(language === 'ar' ? 'تعذرت قراءة الصورة' : 'Could not read the image')
    reader.readAsDataURL(file)
    input.value = ''
  }

  async function updateOrderStatus(id: string, status: string) {
    try {
      const updated = await api(`/api/admin/orders/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) })
      setAdminOrders((current) => current.map((order) => order.id === id ? updated : order))
      notify('تم تحديث حالة الطلب')
    } catch (error) { notify((error as Error).message) }
  }

  function imageSettingField(label: string, key: string, fallback: string) {
    return (
      <div className="image-setting-field wide" key={key}>
        <label>{tx(label)}<input name={key} defaultValue={storeSettings[key] ?? fallback} /></label>
        <label>{language === 'ar' ? 'رفع صورة بديلة' : 'Upload replacement'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadContentImage(event, key)} /></label>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => navigate('/','home')} aria-label={language === 'ar' ? 'العودة للرئيسية' : 'Go to home'}>
          <img className="brand-logo" src={storeSettings.logo_url || '/logo.png'} alt={tx('شعار سنتــــر الأزهر')} />
          <span><strong>{tx(storeSettings.store_name || 'سنتــــر الأزهر')}</strong><small>{tx(storeSettings.store_location || 'شبين القناطر')}</small></span>
        </button>
        <label className="search">
          <span>⌕</span>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.search} />
        </label>
        <nav>
          <button className={`nav-button ${view === 'home' ? 'current' : ''}`} onClick={() => navigate('/','home')}>{copy.home}</button>
          <button className={`nav-button ${view === 'shop' ? 'current' : ''}`} onClick={openShop}>{language === 'ar' ? 'المتجر' : 'Store'}</button>
          <button className="nav-button" onClick={() => navigate('/about','about')}>{copy.about}</button>
          <button className="nav-button" onClick={() => navigate('/contact','contact')}>{copy.contact}</button>
          <button className="icon-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} title={tx('تغيير المظهر')}>{theme === 'light' ? '☾' : '☀'}</button>
          <button className="icon-button" onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')} title="Language">{language === 'ar' ? 'EN' : 'ع'}</button>
          {user ? (
            <button className="nav-button account-nav-button" onClick={() => setView('account')}>
              {user.avatar_url
                ? <img className="account-nav-avatar" src={assetUrl(user.avatar_url)} alt="" />
                : <span className="account-nav-fallback">{user.name.trim().slice(0, 1)}</span>}
              <span>{language === 'ar' ? `مرحباً، ${user.name}` : `Hello, ${user.name}`}</span>
            </button>
          ) : (
            <button className="nav-button" onClick={() => setAuthMode('login')}>{copy.login}</button>
          )}
          {user?.role === 'ADMIN' && <button className="nav-button" onClick={openAdmin}>{tx("لوحة الأدمن")}</button>}
          <button className="cart-button" onClick={() => { setView('cart'); setMobileMenuOpen(false) }}>{copy.cart} <b>{cart.reduce((sum, item) => sum + item.quantity, 0)}</b></button>
          <button className="mobile-menu-toggle" type="button" aria-label={mobileMenuOpen ? (language === 'ar' ? 'إغلاق القائمة' : 'Close menu') : (language === 'ar' ? 'فتح القائمة' : 'Open menu')} aria-expanded={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)}>
            <span></span><span></span><span></span>
          </button>
          {mobileMenuOpen && (
            <div className="mobile-menu">
              <button onClick={() => navigate('/', 'home')}>{copy.home}</button>
              <button onClick={openShop}>{language === 'ar' ? 'المتجر' : 'Store'}</button>
              <button onClick={() => navigate('/about', 'about')}>{copy.about}</button>
              <button onClick={() => navigate('/contact', 'contact')}>{copy.contact}</button>
              {user
                ? <button onClick={() => { setView('account'); setMobileMenuOpen(false) }}>{language === 'ar' ? `حسابي (${user.name})` : `My account (${user.name})`}</button>
                : <button onClick={() => { setAuthMode('login'); setMobileMenuOpen(false) }}>{copy.login}</button>}
              {user?.role === 'ADMIN' && <button onClick={openAdmin}>{language === 'ar' ? 'لوحة الأدمن' : 'Admin dashboard'}</button>}
              <button onClick={() => { setView('cart'); setMobileMenuOpen(false) }}>{copy.cart} ({cart.reduce((sum, item) => sum + item.quantity, 0)})</button>
              <div className="mobile-menu-controls">
                <button onClick={() => { setTheme(theme === 'light' ? 'dark' : 'light'); setMobileMenuOpen(false) }}>{theme === 'light' ? `☾ ${tx('المظهر الداكن')}` : `☀ ${tx('المظهر الفاتح')}`}</button>
                <button onClick={() => { setLanguage(language === 'ar' ? 'en' : 'ar'); setMobileMenuOpen(false) }}>{language === 'ar' ? 'English' : 'العربية'}</button>
              </div>
            </div>
          )}
        </nav>
      </header>

      {view === 'home' && (
        <main className="home-page">
          <section className="home-hero">
            <div className="home-hero-copy">
              <span className="home-kicker"><i aria-hidden="true"></i>{contentText(language, storeSettings, 'home_kicker', 'أقسام متنوعة تحت سقف واحد')}</span>
              <h1>{contentText(language, storeSettings, 'home_title', 'سنتر متعدد الأقسام')} <em>{contentText(language, storeSettings, 'home_emphasis', 'مختص بكل ما يخص الأزهر')}</em></h1>
              <p>{contentText(language, storeSettings, 'home_description', 'من الزي الأزهري والكتب إلى مستلزمات العبادة والهدايا والطباعة؛ تعرّف على أقسام مركز الأزهر وتواصل معنا للاستفسار عن المتاح.')}</p>
              <div className="home-hero-actions">
                <button className="home-primary-button" onClick={openShop}>{contentText(language, storeSettings, 'home_primary_button', 'ادخل إلى المتجر')}<span aria-hidden="true">←</span></button>
                <button className="home-secondary-button" onClick={() => document.getElementById('home-departments')?.scrollIntoView({ behavior: 'smooth' })}>{contentText(language, storeSettings, 'home_secondary_button', 'اكتشف الأقسام')}<span aria-hidden="true">↓</span></button>
              </div>
              <div className="home-location"><span aria-hidden="true">⌖</span>{tx(storeSettings.store_location || 'شبين القناطر')}{language === 'ar' ? '، القليوبية' : ', Qalyubia'}</div>
            </div>
            <div className="home-visual" aria-hidden="true">
              <div className="home-orbit home-orbit-one"></div>
              <div className="home-orbit home-orbit-two"></div>
              <div className="home-photo home-photo-main"><img src={storeSettings.home_image_main || '/about-gallery/library-shelves.png'} alt="" /></div>
              <div className="home-photo home-photo-side"><img src={storeSettings.home_image_side || '/about-gallery/azhar-clothing.png'} alt="" /></div>
              <div className="home-photo home-photo-bottom"><img src={storeSettings.home_image_bottom || '/about-gallery/tasbeeh.png'} alt="" /></div>
              <div className="home-floating-seal"><span>{tx("ٱلْقُرْآنُ")}</span><small>{language === 'ar' ? 'علم • عبادة • هدايا' : 'Knowledge • Worship • Gifts'}</small></div>
              <span className="home-spark home-spark-one">✦</span><span className="home-spark home-spark-two">✧</span>
            </div>
            <div className="hero-scroll-cue" aria-hidden="true"><span></span></div>
          </section>

          <div className="home-ticker" aria-label={language === 'ar' ? 'أقسام المركز' : 'Center departments'}>
            <div className="home-ticker-track">
              {[0, 1].map((repeat) => <span className="home-ticker-group" key={repeat}>
                {departments.map((department) => <span key={department.id}><i aria-hidden="true">✦</i>{language === 'ar' ? storeSettings[department.titleKey] || department.arTitle : department.enTitle}</span>)}
              </span>)}
            </div>
          </div>

          <section className="home-departments" id="home-departments">
            <div className="home-section-heading">
              <div><span className="section-eyebrow">{contentText(language, storeSettings, 'home_departments_eyebrow', 'أقسام سنتر الأزهر')}</span><h2>{contentText(language, storeSettings, 'home_departments_title', 'كل ما تحتاجه… في مكان واحد')}</h2><p>{contentText(language, storeSettings, 'home_departments_description', 'تعرّف على مجالات المركز، واسألنا عن المنتجات والخدمات المتاحة.')}</p></div>
              <button className="text-link" onClick={openShop}>{language === 'ar' ? 'تصفح المتجر' : 'Browse store'}<span aria-hidden="true">←</span></button>
            </div>
            <div className="departments-grid">
              {departments.map((department, index) => (
                <article className="department-card" key={department.id} style={{ animationDelay: `${index * 70}ms` }}>
                  <div className={`department-visual ${(storeSettings[department.imageKey] || department.image) ? '' : 'department-visual-symbol'}`}>
                    {(storeSettings[department.imageKey] || department.image)
                      ? <img src={storeSettings[department.imageKey] || department.image} alt="" loading="lazy" decoding="async" />
                      : <span aria-hidden="true">{department.icon}</span>}
                    <span className="department-index">{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <div className="department-copy">
                    <span className="department-label">{language === 'ar' ? 'من أقسام المركز' : 'Center department'}</span>
                    <h3>{language === 'ar' ? storeSettings[department.titleKey] || department.arTitle : department.enTitle}</h3>
                    <p>{language === 'ar' ? storeSettings[department.descriptionKey] || department.arDescription : department.enDescription}</p>
                    <button className="department-link" onClick={openShop}>{language === 'ar' ? 'تعرّف على المتجر' : 'Explore the store'}<span aria-hidden="true">←</span></button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="home-about-band">
            <div className="home-about-copy">
              <span className="section-eyebrow">{contentText(language, storeSettings, 'home_intro_eyebrow', 'أهلاً بك في سنتر الأزهر')}</span>
              <h2>{contentText(language, storeSettings, 'home_intro_title', 'وجهة واحدة لأقسام أزهرية متعددة')}</h2>
              <p>{contentText(language, storeSettings, 'home_intro_description', 'يجمع المركز الزي الأزهري والكتب الأزهرية وكتب التجويد والقراءات، إلى جانب الإكسسوارات والهدايا ومستلزمات العبادة وطباعة الإجازات والمتون.')}</p>
              <button className="home-secondary-button" onClick={() => navigate('/about','about')}>{contentText(language, storeSettings, 'home_intro_button', 'اعرف المزيد عن المركز')}<span aria-hidden="true">←</span></button>
            </div>
            <div className="home-about-photos" aria-hidden="true">
              <img className="home-about-photo-large" src={storeSettings.home_intro_image_main || '/about-gallery/educational-book.png'} alt="" loading="lazy" />
              <img className="home-about-photo-small" src={storeSettings.home_intro_image_side || '/about-gallery/prayer-accessory.png'} alt="" loading="lazy" />
              <span className="home-about-stamp">{tx(storeSettings.store_name || 'سنتــــر الأزهر')}</span>
            </div>
          </section>

          <section className="home-contact-cta">
            <div><span className="section-eyebrow">{contentText(language, storeSettings, 'home_contact_eyebrow', 'تحتاج مساعدة؟')}</span><h2>{contentText(language, storeSettings, 'home_contact_title', 'اسألنا عن قسم أو خدمة')}</h2><p>{contentText(language, storeSettings, 'home_contact_description', 'تواصل معنا مباشرة لمعرفة التفاصيل والتوافر.')}</p></div>
            <div className="home-contact-actions">
              <a className="home-primary-button" href={whatsappUrl} target="_blank" rel="noopener noreferrer">{contentText(language, storeSettings, 'home_contact_button', 'راسلنا على واتساب')}<span aria-hidden="true">↗</span></a>
              <button className="home-secondary-button" onClick={() => navigate('/contact','contact')}>{language === 'ar' ? 'كل طرق التواصل' : 'All contact details'}<span aria-hidden="true">←</span></button>
            </div>
          </section>
        </main>
      )}

      {view === 'shop' && (
        <>
          <section className="hero">
            <div className="hero-copy">
              <span className="eyebrow">{contentText(language, storeSettings, 'hero_eyebrow', 'كل ما يخص الأزهر وقراءة القرآن')}</span>
              <h1>{language === 'ar' ? (storeSettings.hero_title || 'اختيارات تعينك على') : 'Thoughtfully selected for you'} <em>{language === 'ar' ? (storeSettings.hero_emphasis || 'الخير') : 'every day'}</em></h1>
              <p>{language === 'ar' ? (storeSettings.hero_description || 'كتب أزهرية وكتب تجويد ومصاحف وهدايا مختارة بعناية.') : 'Al-Azhar books, Qurans, tajweed resources and meaningful gifts.'}</p>
              <button onClick={() => document.getElementById('catalog')?.scrollIntoView({ behavior: 'smooth' })}>{contentText(language, storeSettings, 'hero_button', 'تسوق الآن')}</button>
            </div>
            <div className="hero-symbol">
              <div className="book book-one"></div>
              <div className="book book-two"></div>
              <div className="quran-icon">{tx("ٱلْقُرْآنُ")}</div>
            </div>
          </section>

          <main id="catalog" className="catalog">
            <aside>
              <h2>{copy.catalog}</h2>
              <button className={activeCategory === 'all' ? 'active' : ''} onClick={() => setActiveCategory('all')}>
                {copy.all} <span>{products.length}</span>
              </button>
              {categories.map((category) => (
                <button className={activeCategory === category.id ? 'active' : ''} key={category.id} onClick={() => setActiveCategory(category.id)}>
                  {tx(category.name)} <span>{products.filter((product) => product.category_id === category.id).length}</span>
                </button>
              ))}
            </aside>
            <section>
              <div className="catalog-heading">
                <div><span>{products.length ? (language === 'ar' ? 'منتجات مختارة' : 'Featured products') : (language === 'ar' ? 'أصناف المركز' : 'Store categories')}</span><h2>{search ? (language === 'ar' ? 'نتائج البحث' : 'Search results') : activeCategory === 'all' ? (products.length ? (language === 'ar' ? 'جديدنا لك' : 'New arrivals') : (language === 'ar' ? 'تعرّف على أصنافنا' : 'Explore our categories')) : categories.find((category) => category.id === activeCategory)?.name}</h2></div>
                <small>{filtered.length} {language === 'ar' ? 'منتج' : 'products'}</small>
              </div>
              {filtered.length === 0 ? (
                <div className={products.length === 0 && !search ? 'empty empty-store' : 'empty'}>
                  {products.length === 0 && !search ? (
                    <>
                      <span className="empty-store-icon" aria-hidden="true">📚</span>
                      <b>{language === 'ar' ? 'قائمة المنتجات لم تُضف بعد' : 'Products have not been added yet'}</b>
                      <p>{language === 'ar' ? 'الصور تحدد أصناف المتجر، لكن السعر والتوافر يحتاجان تأكيدًا. استفسر عنا مباشرة.' : 'The photos show the store categories, but prices and availability need confirmation. Ask us directly.'}</p>
                      <div className="empty-category-list">
                        {categories.map((category) => <span key={category.id}>{tx(category.name)}</span>)}
                      </div>
                      <a className="empty-whatsapp-link" href={`${whatsappUrl}?text=${whatsappQuestion}`} target="_blank" rel="noopener noreferrer">
                        {language === 'ar' ? 'استفسر عبر واتساب' : 'Ask us on WhatsApp'}
                      </a>
                    </>
                  ) : (
                    <><b>{copy.noResults}</b><p>{language === 'ar' ? 'جرّب اسمًا آخر أو تصنيفًا مختلفًا.' : 'Try another name or category.'}</p></>
                  )}
                </div>
              ) : (
                <div className="product-grid">
                  {filtered.map((product) => (
                    <article className="product-card" key={product.id}>
                      {product.is_featured === 1 && <span className="badge">{tx("الأكثر طلباً")}</span>}
                      <ProductArt product={product} language={language} />
                      <small>{tx(product.category_name)}</small>
                      <h3><button className="product-title-link" onClick={() => openProduct(product)}>{tx(product.name)}</button></h3>
                      <p>{tx(product.description)}</p>
                      <div className="price-row">
                        <div><strong>{money(product.price, language)}</strong>{product.old_price && <del>{money(product.old_price, language)}</del>}</div>
                        <button disabled={product.stock < 1} onClick={() => addToCart(product)}>{product.stock < 1 ? copy.soldOut : `${copy.add} +`}</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </main>
        </>
      )}

      {view === 'cart' && (
        <main className="page cart-page">
          <div className="page-title"><span>{tx("مراجعة مشترياتك")}</span><h1>{tx("سلة التسوق")}</h1></div>
          {cart.length === 0 ? (
            <div className="empty tall"><b>{language === 'ar' ? 'السلة فارغة' : 'Your cart is empty'}</b><p>{language === 'ar' ? 'أضف بعض المنتجات المختارة ثم عد هنا.' : 'Add products and come back here.'}</p><button onClick={openShop}>{language === 'ar' ? 'تصفح المنتجات' : 'Browse products'}</button></div>
          ) : (
            <div className="cart-layout">
              <section className="cart-items">
                {cart.map((item) => (
                  <article className="cart-item" key={item.product.id}>
                    <ProductArt product={item.product} language={language} />
                    <div className="cart-info"><small>{tx(item.product.category_name)}</small><h3>{tx(item.product.name)}</h3><strong>{money(item.product.price, language)}</strong></div>
                    <div className="quantity"><button onClick={() => changeQuantity(item.product.id,item.quantity-1)}>−</button><span>{item.quantity}</span><button onClick={() => changeQuantity(item.product.id,item.quantity+1)}>+</button></div>
                    <button className="remove" onClick={() => setCart((current) => current.filter((entry) => entry.product.id !== item.product.id))}>{tx("حذف")}</button>
                  </article>
                ))}
              </section>
              <aside className="summary">
                <h2>{tx("ملخص الطلب")}</h2><dl><div><dt>{tx("المجموع الفرعي")}</dt><dd>{money(subtotal, language)}</dd></div><div><dt>{tx("التوصيل")}</dt><dd>{shipping ? money(shipping, language) : tx('مجاني')}</dd></div><div className="total"><dt>{tx("الإجمالي")}</dt><dd>{money(subtotal + shipping, language)}</dd></div></dl>
                <button onClick={() => setView('checkout')}>{language === 'ar' ? 'إتمام الطلب' : 'Proceed to checkout'}</button>
              </aside>
            </div>
          )}
        </main>
      )}

      {view === 'checkout' && (
        <main className="page checkout-page">
          <div className="page-title"><span>{language === 'ar' ? 'طريقة الدفع والتوصيل' : 'Payment and delivery'}</span><h1>{language === 'ar' ? 'إتمام الطلب' : 'Checkout'}</h1></div>
          <form className="checkout-form" onSubmit={submitOrder}>
            <section>
              <h2>{tx("معلوماتك")}</h2>
              <div className="form-grid">
                <label>{tx("الاسم بالكامل")}<input name="name" required defaultValue={user?.name ?? ''} /></label>
                <label>{tx("رقم الهاتف")}<input name="phone" required inputMode="tel" defaultValue={user?.phone ?? ''} /></label>
                <label className="wide">{tx('البريد الإلكتروني')}{paymentMethod === 'PAYMOB' && ` (${tx('مطلوب للدفع الإلكتروني')})`}<input name="email" type="email" required={paymentMethod === 'PAYMOB'} defaultValue={user?.email ?? ''} /></label>
                <label>{tx("المحافظة")}<select name="city" required><option value="">{tx("اختر المحافظة")}</option><option>{tx("القليوبية")}</option><option>{tx("القاهرة")}</option><option>{tx("الجيزة")}</option><option>{tx("محافظة أخرى")}</option></select></label>
                <label className="wide">{tx("العنوان بالتفصيل")}<textarea name="address" required rows={3} /></label>
                <label className="wide">{tx("ملاحظات للطلب")}<textarea name="notes" rows={2} /></label>
              </div>
            </section>
            <aside className="summary">
              <h2>{tx("طلبك")}</h2>
              {cart.map((item) => <div className="mini-line" key={item.product.id}><span>{tx(item.product.name)} × {item.quantity}</span><b>{money(item.product.price * item.quantity, language)}</b></div>)}
              <dl><div><dt>{tx("التوصيل")}</dt><dd>{shipping ? money(shipping, language) : tx('مجاني')}</dd></div><div className="total"><dt>{tx("الإجمالي")}</dt><dd>{money(subtotal + shipping, language)}</dd></div></dl>
              <fieldset className="payment-method-options">
                <legend>{tx("طريقة الدفع")}</legend>
                <label><input type="radio" name="payment-method" value="COD" checked={paymentMethod === 'COD'} onChange={() => setPaymentMethod('COD')} />{tx(" الدفع عند الاستلام")}</label>
                {paymobEnabled && <label><input type="radio" name="payment-method" value="PAYMOB" checked={paymentMethod === 'PAYMOB'} onChange={() => setPaymentMethod('PAYMOB')} />{tx(" الدفع الإلكتروني الآمن عبر Paymob")}</label>}
              </fieldset>
              {paymentMethod === 'PAYMOB' && <p className="payment-method-note">{tx("بعد تأكيد الطلب ستنتقل إلى صفحة Paymob لإتمام الدفع؛ بيانات البطاقة لا تمر عبر متجرنا.")}</p>}
              <button type="submit">{tx(paymentMethod === 'PAYMOB' ? 'المتابعة إلى الدفع الإلكتروني' : 'تأكيد الطلب والدفع عند الاستلام')}</button>
            </aside>
          </form>
        </main>
      )}

      {view === 'payment-result' && (
        <main className="page payment-result-page">
          <section className="payment-result-card">
            {!paymentResultOrderId
              ? <><h1>{tx("تعذر تحديد الطلب")}</h1><p>{tx("لم يصل رقم الطلب من بوابة الدفع.")}</p></>
              : paymentResult?.paymentStatus === 'PAID'
                ? <><span className="payment-result-icon success">✓</span><h1>{tx("تم استلام الدفع")}</h1><p>{tx('تم تأكيد طلبك رقم')} {paymentResultOrderId.slice(0, 8)}.</p></>
                : paymentResult?.paymentStatus === 'FAILED' || paymentResult?.paymentStatus === 'EXPIRED'
                  ? <><span className="payment-result-icon failure">!</span><h1>{tx("لم يكتمل الدفع")}</h1><p>{tx('لم يتم تأكيد الدفع للطلب')} {paymentResultOrderId.slice(0, 8)}. {tx('سلتك ما زالت محفوظة؛ يمكنك المحاولة مجددًا أو اختيار الدفع عند الاستلام.')}</p></>
                  : paymentResult?.paymentStatus === 'REVIEW'
                    ? <><span className="payment-result-icon failure">!</span><h1>{tx("الدفع يحتاج إلى مراجعة")}</h1><p>{tx("وصل إشعار دفع لا يمكن تأكيده تلقائيًا. احتفظ برقم الطلب وتواصل مع المركز قبل إعادة الدفع.")}</p></>
                    : paymentResult?.paymentStatus === 'UNAVAILABLE'
                      ? <><h1>{tx("جارٍ التحقق من الدفع")}</h1><p>{tx("تعذر الاتصال بالخادم الآن. لا تعِد الدفع؛ أعد تحميل الصفحة بعد قليل للتحقق من الحالة.")}</p></>
                      : <><span className="payment-result-icon waiting">…</span><h1>{tx("جارٍ التحقق من الدفع")}</h1><p>{tx("قد يستغرق تأكيد العملية لحظات. لا تغلق الصفحة.")}</p></>}
            <div className="payment-result-actions">
              <button onClick={openShop}>{tx("العودة إلى المتجر")}</button>
              {paymentResult?.paymentStatus === 'FAILED' || paymentResult?.paymentStatus === 'EXPIRED'
                ? <button className="secondary" onClick={() => navigate('/cart', 'cart')}>{tx("مراجعة السلة")}</button>
                : null}
            </div>
          </section>
        </main>
      )}

      {view === 'product' && selectedProduct && (
        <main className="page product-page">
          <button className="back-button" onClick={() => navigate('/shop','shop')}>← {language === 'ar' ? 'العودة للمتجر' : 'Back to store'}</button>
          <div className="product-detail">
            <div className="product-detail-image"><ProductArt product={selectedProduct} large language={language} /></div>
            <div className="product-detail-info">
              <small>{tx(selectedProduct.category_name)}</small>
              <h1>{tx(selectedProduct.name)}</h1>
              {selectedProduct.brand && <p><b>{language === 'ar' ? 'الناشر / الماركة:' : 'Brand:'}</b> {tx(selectedProduct.brand)}</p>}
              {selectedProduct.sku && <p><b>SKU:</b> {selectedProduct.sku}</p>}
              {selectedProduct.barcode && <p><b>{language === 'ar' ? 'الباركود:' : 'Barcode:'}</b> {selectedProduct.barcode}</p>}
              <p className="detail-description">{selectedProduct.description ? tx(selectedProduct.description) : (language === 'ar' ? 'لا يوجد وصف إضافي.' : 'No additional description.')}</p>
              <div className="detail-price"><strong>{money(selectedProduct.price, language)}</strong>{selectedProduct.old_price && <del>{money(selectedProduct.old_price, language)}</del>}</div>
              <p className="stock-state">{selectedProduct.stock > 0 ? `${language === 'ar' ? 'متوفر' : 'In stock'} — ${selectedProduct.stock} ${tx(selectedProduct.unit || (language === 'ar' ? 'قطعة' : 'item'))}` : (language === 'ar' ? 'نفد المخزون' : 'Out of stock')}</p>
              <button className="detail-cart" disabled={selectedProduct.stock < 1} onClick={() => addToCart(selectedProduct)}>{language === 'ar' ? 'أضف للسلة' : 'Add to cart'}</button>
            </div>
          </div>
        </main>
      )}

      {view === 'about' && (
        <main className="page info-page about-page">
          <div className="info-hero">
            <span>{contentText(language, storeSettings, 'about_eyebrow', 'تعرف علينا')}</span>
            <h1>{contentText(language, storeSettings, 'about_title', 'سنتــــر الأزهر')}</h1>
            <p>{contentText(language, storeSettings, 'about_description', 'مكتبة ومستلزمات أزهرية في شبين القناطر، محافظة القليوبية.')}</p>
          </div>
          {visibleGalleryItems.length > 0 && (
            <section className="about-gallery-section" aria-label={language === 'ar' ? 'صور المركز' : 'Center photos'}>
              <div className="about-gallery-heading">
                <div><span className="about-eyebrow">{contentText(language, storeSettings, 'about_gallery_eyebrow', 'من صور المركز')}</span><h2>{contentText(language, storeSettings, 'about_gallery_title', 'المكتبة ومقتنياتها')}</h2></div>
                <p>{contentText(language, storeSettings, 'about_gallery_description', 'صور منفصلة من الصور التي شاركتها.')}</p>
              </div>
              <div className="about-gallery">
                {visibleGalleryItems.map((item) => (
                  <figure className="about-photo-card" key={item.id}>
                    <a href={assetUrl(item.image_url)} target="_blank" rel="noopener noreferrer">
                      <img src={assetUrl(item.image_url)} alt={localizedText(language, item.title)} loading="lazy" decoding="async" />
                    </a>
                    <figcaption>{tx(item.title)}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
          {visibleAboutSections.length > 0 && (
            <section className="about-content-sections" aria-label={language === 'ar' ? 'أقسام المركز الإضافية' : 'Additional center sections'}>
              {visibleAboutSections.map((item) => (
                <article className={`about-content-card ${item.image_url ? 'has-image' : ''}`} key={item.id}>
                  {item.image_url && <img src={assetUrl(item.image_url)} alt={localizedText(language, item.title)} loading="lazy" decoding="async" />}
                  <div><span className="about-eyebrow">{language === 'ar' ? 'من محتوى المركز' : 'From the center'}</span><h2>{tx(item.title)}</h2><p>{tx(item.description)}</p></div>
                </article>
              ))}
            </section>
          )}
        </main>
      )}

      {view === 'contact' && (
        <main className="page info-page">
          <div className="page-title"><span>{contentText(language, storeSettings, 'contact_eyebrow', 'نحن هنا لخدمتك')}</span><h1>{contentText(language, storeSettings, 'contact_title', 'تواصل معنا')}</h1></div>
          <div className="contact-grid">
            <article className="contact-address-card"><b>📍 {language === 'ar' ? 'عنواننا' : 'Our address'}</b><p>{tx(storeAddress)}</p><a href={storeMapUrl} target="_blank" rel="noopener noreferrer">{language === 'ar' ? 'افتح الموقع على خرائط Google' : 'Open in Google Maps'} ↗</a></article>
            <article><b>🟢 {language === 'ar' ? 'واتساب' : 'WhatsApp'}</b><p><a href={whatsappUrl} target="_blank" rel="noopener noreferrer">{storeSettings.store_whatsapp || '+20 1067920688'}</a></p></article>
            <article><b>✉️ {language === 'ar' ? 'البريد الإلكتروني' : 'Email'}</b><p><a href={`mailto:${storeEmail}`}>{storeEmail}</a></p></article>
            <article><b>🔵 {language === 'ar' ? 'فيسبوك' : 'Facebook'}</b><p><a href={storeFacebook} target="_blank" rel="noopener noreferrer">{language === 'ar' ? 'صفحة المركز' : 'Center page'}</a></p></article>
            <article><b>📷 Instagram</b><p><a href={storeInstagram} target="_blank" rel="noopener noreferrer">@alazhar.center.eg</a></p></article>
            <article><b>▶️ YouTube</b><p><a href={storeYoutube} target="_blank" rel="noopener noreferrer">@AlAzharCenter</a></p></article>
            <article><b>💬 {language === 'ar' ? 'المساعد' : 'Assistant'}</b><p>{contentText(language, storeSettings, 'contact_assistant_description', 'اسأل المساعد الظاهر أسفل الشاشة.')}</p></article>
            <article><b>📦 {language === 'ar' ? 'الطلبات' : 'Orders'}</b><p>{contentText(language, storeSettings, 'contact_orders_description', 'الدفع عند الاستلام ومتابعة حالة الطلب من الحساب.')}</p></article>
          </div>
        </main>
      )}

      {view === 'account' && user && (
        <main className="page account-page">
          <div className="page-title"><span>{language === 'ar' ? 'إعداداتك الشخصية' : 'Your personal settings'}</span><h1>{language === 'ar' ? 'حسابي' : 'My account'}</h1></div>
          <div className="account-layout">
            <section className="account-profile-card">
              <div className="profile-photo-section">
                <div className="profile-avatar">
                  {user.avatar_url
                    ? <img src={assetUrl(user.avatar_url)} alt={language === 'ar' ? 'الصورة الشخصية' : 'Profile photo'} />
                    : <span>{user.name.trim().slice(0, 1)}</span>}
                </div>
                <label className="avatar-upload-button">
                  {language === 'ar' ? 'تغيير الصورة' : 'Change photo'}
                  <input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadAvatar} />
                </label>
                <small>{language === 'ar' ? 'JPG أو PNG أو WebP' : 'JPG, PNG, or WebP'}</small>
              </div>
              <form className="account-profile-form" onSubmit={saveProfile}>
                <div className="account-section-heading">
                  <h2>{language === 'ar' ? 'البيانات الشخصية' : 'Profile details'}</h2>
                  <p>{language === 'ar' ? 'حدّث اسمك وتفضيلات ألوان الموقع وحجم الخط.' : 'Update your name, site color, and font size preferences.'}</p>
                </div>
                <label>
                  {language === 'ar' ? 'الاسم' : 'Name'}
                  <input value={profileName} onChange={(event) => setProfileName(event.target.value)} minLength={2} maxLength={80} required />
                </label>
                <div className="account-color-setting">
                  <div><b>{language === 'ar' ? 'لون الموقع' : 'Site color'}</b><small>{language === 'ar' ? 'يُحفظ التغيير مع بيانات حسابك.' : 'Saved with your account details.'}</small></div>
                  <div className="account-color-options">
                    <label className="color-wheel" title={language === 'ar' ? 'اختيار لون مخصص' : 'Choose a custom color'}>
                      <input type="color" value={accentColor} onChange={(event) => { setAccentColor(event.target.value); setAccentColorDirty(true) }} aria-label={language === 'ar' ? 'اختيار لون مخصص' : 'Choose a custom color'} />
                      <span>{language === 'ar' ? 'لون مخصص' : 'Custom'}</span>
                    </label>
                    <div className="color-presets">
                      {accentPresets.map((preset) => (
                        <button
                          key={preset.color}
                          type="button"
                          className={accentColor.toLowerCase() === preset.color ? 'color-preset active' : 'color-preset'}
                          style={{ backgroundColor: preset.color }}
                          title={language === 'ar' ? preset.ar : preset.en}
                          aria-label={language === 'ar' ? preset.ar : preset.en}
                          aria-pressed={accentColor.toLowerCase() === preset.color}
                          onClick={() => { setAccentColor(preset.color); setAccentColorDirty(true) }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="account-font-setting">
                  <div><b>{language === 'ar' ? 'حجم الخط' : 'Font size'}</b><small>{language === 'ar' ? 'اختر الحجم المناسب لك، ثم احفظ التعديلات.' : 'Choose a comfortable size, then save your changes.'}</small></div>
                  <div className="font-size-options" role="group" aria-label={language === 'ar' ? 'حجم الخط' : 'Font size'}>
                    {([
                      ['small', language === 'ar' ? 'صغير' : 'Small'],
                      ['normal', language === 'ar' ? 'عادي' : 'Default'],
                      ['large', language === 'ar' ? 'كبير' : 'Large'],
                      ['xlarge', language === 'ar' ? 'أكبر' : 'Largest'],
                    ] as const).map(([scale, label]) => (
                      <button key={scale} type="button" className={fontScale === scale ? 'font-size-option active' : 'font-size-option'} aria-pressed={fontScale === scale} onClick={() => setFontScale(scale)}>{label}</button>
                    ))}
                  </div>
                </div>
                <button className="account-primary-button" type="submit">{language === 'ar' ? 'حفظ التعديلات' : 'Save changes'}</button>
              </form>
            </section>
            <div className="account-side">
              <section className="account-card">
                <h2>{language === 'ar' ? 'بيانات الحساب' : 'Account information'}</h2>
                <dl>
                  <div><dt>{language === 'ar' ? 'البريد الإلكتروني' : 'Email'}</dt><dd>{user.email}</dd></div>
                  <div><dt>{language === 'ar' ? 'الهاتف' : 'Phone'}</dt><dd>{user.phone}</dd></div>
                  <div><dt>{language === 'ar' ? 'نوع الحساب' : 'Account type'}</dt><dd>{user.role === 'ADMIN' ? (language === 'ar' ? 'إدارة المتجر' : 'Admin') : (language === 'ar' ? 'عميل' : 'Customer')}</dd></div>
                </dl>
              </section>
              <form className="account-password-form" onSubmit={changePassword}>
                <h2>{language === 'ar' ? 'تغيير كلمة المرور' : 'Change password'}</h2>
                <label>{language === 'ar' ? 'كلمة المرور الحالية' : 'Current password'}<PasswordField name="currentPassword" language={language} autoComplete="current-password" /></label>
                <label>{language === 'ar' ? 'كلمة المرور الجديدة' : 'New password'}<PasswordField name="newPassword" language={language} minLength={8} autoComplete="new-password" /></label>
                <label>{language === 'ar' ? 'تأكيد كلمة المرور الجديدة' : 'Confirm new password'}<PasswordField name="confirmPassword" language={language} minLength={8} autoComplete="new-password" /></label>
                <small>{language === 'ar' ? '8 أحرف على الأقل. ستظل مسجلاً على هذا الجهاز فقط.' : 'At least 8 characters. This device stays signed in.'}</small>
                <button className="account-primary-button" type="submit">{language === 'ar' ? 'تحديث كلمة المرور' : 'Update password'}</button>
              </form>
              <button className="account-logout-button" onClick={logout}>{language === 'ar' ? 'تسجيل الخروج' : 'Sign out'}</button>
            </div>
          </div>
        </main>
      )}

      {view === 'admin' && user?.role === 'ADMIN' && (
        <main className="page admin-page">
          <div className="page-title"><span>{language === 'ar' ? 'إدارة المتجر' : 'Store management'}</span><h1>{language === 'ar' ? 'لوحة التحكم' : 'Dashboard'}</h1></div>
          <nav className="admin-tabs">
            <button className={adminTab === 'orders' ? 'active' : ''} onClick={() => setAdminTab('orders')}>{language === 'ar' ? 'الطلبات' : 'Orders'}</button>
            <button className={adminTab === 'products' ? 'active' : ''} onClick={() => setAdminTab('products')}>{language === 'ar' ? 'المنتجات' : 'Products'}</button>
            <button className={adminTab === 'categories' ? 'active' : ''} onClick={() => setAdminTab('categories')}>{language === 'ar' ? 'التصنيفات' : 'Categories'}</button>
            <button className={adminTab === 'settings' ? 'active' : ''} onClick={() => setAdminTab('settings')}>{language === 'ar' ? 'إعدادات الموقع' : 'Store settings'}</button>
            <button className={adminTab === 'content' ? 'active' : ''} onClick={() => setAdminTab('content')}>{language === 'ar' ? 'محتوى الصفحات' : 'Page content'}</button>
            <button className={adminTab === 'users' ? 'active' : ''} onClick={() => setAdminTab('users')}>{language === 'ar' ? 'الحسابات' : 'Accounts'}</button>
          </nav>

          {adminTab === 'orders' && (
            adminOrders.length === 0 ? <div className="empty tall"><b>{tx("لا توجد طلبات حتى الآن")}</b></div> : (
              <div className="orders-table">
                {adminOrders.map((order) => (
                  <article key={order.id}>
                    <div><small>{tx("رقم الطلب")}</small><b>{order.id.slice(0,8)}</b></div>
                    <div><small>{tx("العميل")}</small><b>{order.customer_name}</b><span>{order.phone}</span></div>
                    <div><small>{tx("العنوان")}</small><span>{order.city} — {order.address}</span></div>
                    <div>
                      <small>{tx("الإجمالي")}</small><b>{money(order.total, language)}</b>
                      <small>{tx(order.payment_method === 'PAYMOB' ? 'الدفع الإلكتروني — Paymob' : 'الدفع عند الاستلام')}</small>
                      {order.payment_method === 'PAYMOB' && <small className={`payment-admin-status payment-${String(order.payment_status).toLowerCase()}`}>{tx(({
                        PENDING:'بانتظار الدفع', PAID:'تم الدفع', FAILED:'فشل الدفع', EXPIRED:'انتهت مهلة الدفع', REVIEW:'مراجعة مطلوبة',
                      } as Record<string,string>)[order.payment_status] || order.payment_status)}</small>}
                    </div>
                    <select value={order.status} onChange={(event) => updateOrderStatus(order.id,event.target.value)}>
                      <option value="PENDING">{tx("قيد الانتظار")}</option><option value="CONFIRMED">{tx("مؤكد")}</option><option value="SHIPPED">{tx("تم الشحن")}</option><option value="DELIVERED">{tx("تم التسليم")}</option><option value="CANCELLED">{tx("ملغي")}</option>
                    </select>
                  </article>
                ))}
              </div>
            )
          )}

          {adminTab === 'products' && (
            <div className="admin-layout">
              <form className="admin-editor" onSubmit={saveProduct}>
                <h2>{tx("إضافة أو تعديل منتج")}</h2>
                <input type="hidden" name="id" />
                <div className="form-grid">
                  <label>{tx("اسم المنتج")}<input name="name" required /></label>
                  <label>{tx("التصنيف")}<select name="categoryId" required><option value="">{tx("اختر التصنيف")}</option>{categories.map((category) => <option value={category.id} key={category.id}>{tx(category.name)}</option>)}</select></label>
                  <label>{tx("السعر")}<input name="price" type="number" min="0" required /></label>
                  <label>{tx("السعر القديم")}<input name="oldPrice" type="number" min="0" /></label>
                  <label>{tx("المخزون")}<input name="stock" type="number" min="0" required /></label>
                  <label>{tx("الوحدة")}<input name="unit" defaultValue="قطعة" /></label>
                  <label>{tx("الماركة / الناشر")}<input name="brand" /></label>
                  <label>{tx("كود المخزون SKU")}<input name="sku" /></label>
                  <label>{tx("الباركود")}<input name="barcode" /></label>
                  <label>{tx("رابط الصورة")}<input name="imageUrl" /></label>
                  {media.length > 0 && (
                    <div className="media-picker wide">
                      <b>{language === 'ar' ? 'صور المتجر المرفقة' : 'Uploaded store images'}</b>
                      <div>
                        {media.map((item) => (
                          <button type="button" key={item.url} onClick={() => {
                            const input = document.querySelector<HTMLInputElement>('input[name="imageUrl"]')
                            if (input) input.value = item.url
                          }} title={item.name}>
                            <img src={item.url} alt={item.name} />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <label className="wide">{tx("الوصف")}<textarea name="description" rows={4} /></label>
                  <label className="check-label"><input name="featured" type="checkbox" />{tx(" منتج مميز")}</label>
                  <label className="check-label"><input name="isActive" type="checkbox" defaultChecked />{tx(" ظاهر للمتجر")}</label>
                  <label className="wide">{tx("رفع صورة")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadImage(event,'product')} /></label>
                </div>
                <button type="submit" className="admin-save">{tx("حفظ المنتج")}</button>
              </form>
              <div className="admin-product-list">
                {adminProducts.length === 0 ? <div className="empty"><b>{tx("لا توجد منتجات")}</b></div> : adminProducts.map((product) => (
                  <article key={product.id}>
                    <div><b>{tx(product.name)}</b><small>{tx(product.category_name || 'بدون تصنيف')} • {tx('مخزون')} {product.stock}</small></div>
                    <strong>{money(product.price, language)}</strong>
                    <span className={product.is_active ? 'status live' : 'status'}>{product.is_active ? tx('ظاهر') : tx('مخفي')}</span>
                    <button onClick={() => {
                      const form = document.querySelector<HTMLFormElement>('.admin-editor')
                      if (!form) return
                      const set = (name: string, value: any) => { const input = form.elements.namedItem(name) as HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement|null; if (input) input.value = value == null ? '' : String(value) }
                      set('id',product.id); set('name',product.name); set('categoryId',product.category_id); set('description',product.description); set('price',product.price); set('oldPrice',product.old_price); set('stock',product.stock); set('unit',product.unit); set('brand',product.brand); set('sku',product.sku); set('barcode',product.barcode); set('imageUrl',product.image_url)
                      const featured = form.elements.namedItem('featured') as HTMLInputElement|null
                      const active = form.elements.namedItem('isActive') as HTMLInputElement|null
                      if (featured) featured.checked = product.is_featured === 1
                      if (active) active.checked = product.is_active === 1
                    }}>{tx("تعديل")}</button>
                    <button className="danger" onClick={() => deleteProduct(product.id)}>{tx("إلغاء العرض")}</button>
                  </article>
                ))}
              </div>
            </div>
          )}

          {adminTab === 'categories' && (
            <div className="admin-layout">
              <form className="admin-editor category-editor" onSubmit={createCategory}>
                <h2>{tx(editingCategoryId ? 'تعديل تصنيف' : 'إضافة تصنيف')}</h2>
                <input type="hidden" name="id" />
                <div className="form-grid">
                  <label>{tx("اسم التصنيف")}<input name="name" required /></label>
                  <label>{tx("الاسم في الرابط")}<input name="slug" placeholder="اختياري" /></label>
                </div>
                <button type="submit" className="admin-save">{tx(editingCategoryId ? 'حفظ التعديل' : 'إضافة التصنيف')}</button>
                {editingCategoryId && <button type="button" className="account-logout-button" onClick={(event) => {
                  event.currentTarget.form?.reset()
                  setEditingCategoryId('')
                }}>{tx("إلغاء التعديل")}</button>}
              </form>
              <div className="admin-product-list">
                {categories.map((category) => (
                  <article key={category.id}>
                    <div><b>{tx(category.name)}</b><small>/ {category.slug}</small></div>
                    <button onClick={() => {
                      const form = document.querySelector<HTMLFormElement>('.category-editor')
                      if (!form) return
                      const id = form.elements.namedItem('id') as HTMLInputElement
                      const name = form.elements.namedItem('name') as HTMLInputElement
                      const slug = form.elements.namedItem('slug') as HTMLInputElement
                      id.value = category.id
                      name.value = category.name
                      slug.value = category.slug
                      setEditingCategoryId(category.id)
                      form.scrollIntoView({ behavior: 'smooth', block: 'center' })
                      name.focus()
                    }}>{tx("تعديل")}</button>
                    <button className="danger" onClick={() => deleteCategory(category.id)}>{tx("حذف")}</button>
                  </article>
                ))}
              </div>
            </div>
          )}

          {adminTab === 'settings' && (
            <form className="admin-editor settings-editor" onSubmit={updateStoreSettings}>
              <h2>{tx("التحكم في محتوى وتصميم الموقع")}</h2>
              <p className="settings-intro">{tx("عدّل النصوص والصور وبيانات التواصل من هنا؛ التغييرات تظهر على الموقع بعد الحفظ.")}</p>

              <fieldset className="settings-group wide">
                <legend>{tx("هوية المركز والتواصل والفوتر")}</legend>
                <div className="form-grid">
                  <label>{tx("اسم المتجر")}<input name="store_name" defaultValue={storeSettings.store_name || 'سنتــــر الأزهر'} /></label>
                  <label>{tx("المكان / الفرع")}<input name="store_location" defaultValue={storeSettings.store_location || 'شبين القناطر'} /></label>
                  <label>{tx("رقم واتساب")}<input name="store_whatsapp" type="tel" defaultValue={storeSettings.store_whatsapp || '+20 1067920688'} /></label>
                  <label>{tx("البريد الإلكتروني")}<input name="store_email" type="email" defaultValue={storeSettings.store_email || 'abdoflaw01@gmail.com'} /></label>
                  <label className="wide">{tx("رابط صفحة فيسبوك")}<input name="store_facebook" type="url" defaultValue={storeSettings.store_facebook || 'https://www.facebook.com/alazhar.center.eg/'} /></label>
                  <label>{tx("رابط Instagram")}<input name="store_instagram" type="url" defaultValue={storeSettings.store_instagram || 'https://www.instagram.com/alazhar.center.eg/'} /></label>
                  <label>{tx("رابط YouTube")}<input name="store_youtube" type="url" defaultValue={storeSettings.store_youtube || 'https://www.youtube.com/@AlAzharCenter'} /></label>
                  <label className="wide">{tx("رابط الموقع على الخريطة")}<input name="store_map_url" type="url" defaultValue={storeSettings.store_map_url || 'https://maps.app.goo.gl/n78L79Ru6HRC6uP3A'} /></label>
                  <label className="wide">{tx("العنوان بالتفصيل")}<textarea name="store_address" rows={2} defaultValue={storeSettings.store_address || 'الإدارة التعليمية، شارع الإدارة التعليمية والسنترال، مدينة شبين القناطر، محافظة القليوبية 6335231'} /></label>
                  <label>{tx("لون الموقع الأساسي")}<input name="site_accent_color" type="color" defaultValue={storeSettings.site_accent_color || '#1f5d3a'} /></label>
                  <label>{tx("نص تعريف الفوتر")}<input name="footer_description" defaultValue={storeSettings.footer_description || ''} /></label>
                  <label className="wide">{tx("النص السفلي للفوتر")}<input name="footer_text" defaultValue={storeSettings.footer_text || ''} /></label>
                  <label className="wide">{tx("تغيير شعار المتجر")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadImage(event,'logo')} /></label>
                </div>
              </fieldset>

              <fieldset className="settings-group wide">
                <legend>{tx("الصفحة الرئيسية")}</legend>
                <div className="form-grid">
                  <label>{tx("الشارة الصغيرة")}<input name="home_kicker" defaultValue={storeSettings.home_kicker || ''} /></label>
                  <label>{tx("عنوان رئيسي")}<input name="home_title" defaultValue={storeSettings.home_title || ''} /></label>
                  <label>{tx("الكلمة المميزة")}<input name="home_emphasis" defaultValue={storeSettings.home_emphasis || ''} /></label>
                  <label>{tx("زر المتجر")}<input name="home_primary_button" defaultValue={storeSettings.home_primary_button || ''} /></label>
                  <label>{tx("زر عرض الأقسام")}<input name="home_secondary_button" defaultValue={storeSettings.home_secondary_button || ''} /></label>
                  <label className="wide">{tx("وصف الواجهة الرئيسية")}<textarea name="home_description" rows={3} defaultValue={storeSettings.home_description || ''} /></label>
                  {imageSettingField('الصورة الرئيسية','home_image_main','/about-gallery/library-shelves.png')}
                  {imageSettingField('الصورة الجانبية','home_image_side','/about-gallery/azhar-clothing.png')}
                  {imageSettingField('الصورة السفلية','home_image_bottom','/about-gallery/tasbeeh.png')}
                </div>
              </fieldset>

              <fieldset className="settings-group wide">
                <legend>{tx("قسم الأقسام في الرئيسية")}</legend>
                <div className="form-grid">
                  <label>{tx("العنوان الصغير")}<input name="home_departments_eyebrow" defaultValue={storeSettings.home_departments_eyebrow || ''} /></label>
                  <label>{tx("عنوان القسم")}<input name="home_departments_title" defaultValue={storeSettings.home_departments_title || ''} /></label>
                  <label className="wide">{tx("وصف القسم")}<textarea name="home_departments_description" rows={2} defaultValue={storeSettings.home_departments_description || ''} /></label>
                  {departments.map((department) => (
                    <div className="department-setting wide" key={department.id}>
                      <strong>{department.arTitle}</strong>
                      <div className="form-grid">
                        <label>{tx("اسم القسم")}<input name={department.titleKey} defaultValue={storeSettings[department.titleKey] || department.arTitle} /></label>
                        <label>{tx("وصف القسم")}<textarea name={department.descriptionKey} rows={2} defaultValue={storeSettings[department.descriptionKey] || department.arDescription} /></label>
                        {imageSettingField(`صورة ${department.arTitle}`, department.imageKey, department.image)}
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>

              <fieldset className="settings-group wide">
                <legend>{tx("نبذة ونداء التواصل في الرئيسية")}</legend>
                <div className="form-grid">
                  <label>{tx("عنوان نبذة المركز")}<input name="home_intro_eyebrow" defaultValue={storeSettings.home_intro_eyebrow || ''} /></label>
                  <label>{tx("عنوان النبذة")}<input name="home_intro_title" defaultValue={storeSettings.home_intro_title || ''} /></label>
                  <label className="wide">{tx("نص النبذة")}<textarea name="home_intro_description" rows={3} defaultValue={storeSettings.home_intro_description || ''} /></label>
                  <label>{tx("زر النبذة")}<input name="home_intro_button" defaultValue={storeSettings.home_intro_button || ''} /></label>
                  {imageSettingField('صورة النبذة الأولى','home_intro_image_main','/about-gallery/educational-book.png')}
                  {imageSettingField('صورة النبذة الثانية','home_intro_image_side','/about-gallery/prayer-accessory.png')}
                  <label>{tx("عنوان دعوة التواصل")}<input name="home_contact_eyebrow" defaultValue={storeSettings.home_contact_eyebrow || ''} /></label>
                  <label>{tx("العنوان الرئيسي للتواصل")}<input name="home_contact_title" defaultValue={storeSettings.home_contact_title || ''} /></label>
                  <label className="wide">{tx("وصف دعوة التواصل")}<textarea name="home_contact_description" rows={2} defaultValue={storeSettings.home_contact_description || ''} /></label>
                  <label>{tx("زر واتساب")}<input name="home_contact_button" defaultValue={storeSettings.home_contact_button || ''} /></label>
                </div>
              </fieldset>

              <fieldset className="settings-group wide">
                <legend>{tx("بانر المتجر والشحن")}</legend>
                <div className="form-grid">
                  <label>{tx("عنوان البانر الصغير")}<input name="hero_eyebrow" defaultValue={storeSettings.hero_eyebrow || ''} /></label>
                  <label>{tx("كلمة زر التسوق")}<input name="hero_button" defaultValue={storeSettings.hero_button || 'تسوق الآن'} /></label>
                  <label className="wide">{tx("عنوان البانر")}<input name="hero_title" defaultValue={storeSettings.hero_title || ''} /></label>
                  <label>{tx("الكلمة المميزة")}<input name="hero_emphasis" defaultValue={storeSettings.hero_emphasis || ''} /></label>
                  <label className="wide">{tx("وصف البانر")}<textarea name="hero_description" rows={2} defaultValue={storeSettings.hero_description || ''} /></label>
                  <label>{tx("رسوم التوصيل بالجنيه")}<input name="shipping_fee" type="number" min="0" defaultValue={storeSettings.shipping_fee || '35'} /></label>
                  <label>{tx("حد التوصيل المجاني بالجنيه")}<input name="free_shipping_threshold" type="number" min="0" defaultValue={storeSettings.free_shipping_threshold || '500'} /></label>
                </div>
              </fieldset>

              <fieldset className="settings-group wide">
                <legend>{tx("صفحة عن المركز والصور")}</legend>
                <div className="form-grid">
                  <label>{tx("العنوان الصغير")}<input name="about_eyebrow" defaultValue={storeSettings.about_eyebrow || ''} /></label>
                  <label>{tx("عنوان الصفحة")}<input name="about_title" defaultValue={storeSettings.about_title || ''} /></label>
                  <label className="wide">{tx("نبذة عن المركز")}<textarea name="about_description" rows={3} defaultValue={storeSettings.about_description || ''} /></label>
                  <label>{tx("عنوان معرض الصور")}<input name="about_gallery_eyebrow" defaultValue={storeSettings.about_gallery_eyebrow || ''} /></label>
                  <label>{tx("عنوان مجموعة الصور")}<input name="about_gallery_title" defaultValue={storeSettings.about_gallery_title || ''} /></label>
                  <label className="wide">{tx("وصف معرض الصور")}<textarea name="about_gallery_description" rows={2} defaultValue={storeSettings.about_gallery_description || ''} /></label>
                </div>
              </fieldset>

              <fieldset className="settings-group wide">
                <legend>{tx("صفحة التواصل")}</legend>
                <div className="form-grid">
                  <label>{tx("العنوان الصغير")}<input name="contact_eyebrow" defaultValue={storeSettings.contact_eyebrow || ''} /></label>
                  <label>{tx("عنوان الصفحة")}<input name="contact_title" defaultValue={storeSettings.contact_title || ''} /></label>
                  <label className="wide">{tx("وصف بطاقة المساعد")}<textarea name="contact_assistant_description" rows={2} defaultValue={storeSettings.contact_assistant_description || ''} /></label>
                  <label className="wide">{tx("وصف بطاقة الطلبات")}<textarea name="contact_orders_description" rows={2} defaultValue={storeSettings.contact_orders_description || ''} /></label>
                </div>
              </fieldset>
              <button type="submit" className="admin-save">{tx("حفظ إعدادات الموقع")}</button>
            </form>
          )}

          {adminTab === 'content' && (
            <section className="site-content-manager">
              <div className="site-content-toolbar">
                <div><h2>{tx("إدارة معرض الصور والأقسام")}</h2><p>{tx("أضف أي عدد تحتاجه من الصور أو الأقسام؛ ستظهر العناصر المنشورة في صفحة «عن المركز».")}</p></div>
                <div>
                  <button type="button" onClick={() => startContentDraft('IMAGE')}>{tx("＋ إضافة صورة")}</button>
                  <button type="button" onClick={() => startContentDraft('SECTION')}>{tx("＋ إضافة قسم")}</button>
                </div>
              </div>
              {contentDraft && (
                <form className="site-content-editor" onSubmit={saveSiteContent}>
                  <h3>{tx(contentDraft.id ? 'تعديل المحتوى' : contentDraft.kind === 'IMAGE' ? 'إضافة صورة إلى المعرض' : 'إضافة قسم جديد')}</h3>
                  <label>{tx("العنوان / وصف الصورة")}<input value={contentDraft.title} maxLength={150} onChange={(event) => setContentDraft((current) => current ? { ...current, title: event.target.value } : current)} required /></label>
                  {contentDraft.kind === 'SECTION' && <label>{tx("نص القسم")}<textarea value={contentDraft.description} maxLength={2000} rows={4} onChange={(event) => setContentDraft((current) => current ? { ...current, description: event.target.value } : current)} /></label>}
                  {(contentDraft.kind === 'IMAGE' || contentDraft.kind === 'SECTION') && (
                    <div className="managed-image-field">
                      <label>{tx("رابط الصورة (اختياري للقسم)")}<input value={contentDraft.image_url} onChange={(event) => setContentDraft((current) => current ? { ...current, image_url: event.target.value } : current)} /></label>
                      <label>{tx("رفع صورة من جهازك")}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={uploadManagedContentImage} /></label>
                    </div>
                  )}
                  <label className="content-visibility-toggle"><input type="checkbox" checked={contentDraft.is_visible === 1} onChange={(event) => setContentDraft((current) => current ? { ...current, is_visible: event.target.checked ? 1 : 0 } : current)} />{tx(" إظهار هذا المحتوى على الموقع")}</label>
                  <div className="content-editor-actions">
                    <button className="admin-save" type="submit">{tx(contentDraft.id ? 'حفظ التعديل' : 'إضافة إلى الموقع')}</button>
                    <button className="account-logout-button" type="button" onClick={() => setContentDraft(null)}>{tx("إلغاء")}</button>
                  </div>
                </form>
              )}
              {siteContent.length === 0 ? <div className="empty"><b>{tx("لا يوجد محتوى مضاف بعد")}</b></div> : (
                <div className="site-content-list">
                  {siteContent.map((item) => (
                    <article className="site-content-row" key={item.id}>
                      {item.image_url
                        ? <img src={assetUrl(item.image_url)} alt="" loading="lazy" />
                        : <span className="site-content-placeholder" aria-hidden="true">▤</span>}
                      <div className="site-content-summary">
                        <span className="site-content-type">{tx(item.kind === 'IMAGE' ? 'صورة معرض' : 'قسم محتوى')}</span>
                        <h3>{tx(item.title)}</h3>
                        {item.description && <p>{tx(item.description)}</p>}
                      </div>
                      <span className={`status ${item.is_visible === 1 ? 'live' : ''}`}>{tx(item.is_visible === 1 ? 'ظاهر' : 'مخفي')}</span>
                      <div className="site-content-actions">
                        <button type="button" onClick={() => setContentDraft({ id:item.id, kind:item.kind, title:item.title, description:item.description, image_url:item.image_url, is_visible:item.is_visible })}>{tx("تعديل")}</button>
                        <button type="button" onClick={() => toggleSiteContent(item)}>{tx(item.is_visible === 1 ? 'إخفاء' : 'إظهار')}</button>
                        <button type="button" className="danger" onClick={() => deleteSiteContent(item.id)}>{tx("حذف")}</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          )}

          {adminTab === 'users' && (
            <>
              <div className="admin-user-status-legend">
                <span>{language === 'ar' ? 'النشاط يعتمد على اتصال حديث خلال آخر دقيقتين. تفعيل الحساب يظهر منفصلًا.' : 'Presence reflects a heartbeat within the last two minutes. Account access is shown separately.'}</span>
                <b className="status live">{adminUsers.filter((account) => account.is_online === 1).length} {language === 'ar' ? 'متصل الآن' : 'Online now'}</b>
                <b className="status">{adminUsers.filter((account) => account.is_online !== 1).length} {language === 'ar' ? 'غير متصل' : 'Offline'}</b>
              </div>
              <div className="admin-users">
                {adminUsers.map((account) => (
                  <article key={account.id}>
                    <div><b>{account.name}</b><small>{account.email}</small></div>
                    <span>{account.phone}</span>
                    <strong>{account.role === 'ADMIN' ? (language === 'ar' ? 'مدير' : 'Admin') : (language === 'ar' ? 'عميل' : 'Customer')}</strong>
                    <div className="account-presence-stack">
                      <span className={`status ${account.is_online === 1 ? 'live' : ''}`}>
                        {account.is_online === 1 ? (language === 'ar' ? 'متصل الآن' : 'Online now') : (language === 'ar' ? 'غير متصل' : 'Offline')}
                      </span>
                      <small className={`account-enabled-status ${account.account_status === 'ACTIVE' ? 'enabled' : 'disabled'}`}>
                        {account.account_status === 'ACTIVE' ? (language === 'ar' ? 'الحساب مفعّل' : 'Account enabled') : (language === 'ar' ? 'الحساب معطّل' : 'Account disabled')}
                      </small>
                      <small>{formatLastSeen(account.last_seen_at, language)}</small>
                    </div>
                    {account.role !== 'ADMIN' && (
                      <div className="account-actions">
                        <button onClick={() => setAccountStatus(account.id, account.account_status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')}>
                          {account.account_status === 'ACTIVE' ? (language === 'ar' ? 'تعطيل' : 'Disable') : (language === 'ar' ? 'إعادة تفعيل' : 'Reactivate')}
                        </button>
                        <button className="danger" onClick={() => permanentlyDeleteAccount(account.id)}>
                          {language === 'ar' ? 'حذف نهائي' : 'Delete permanently'}
                        </button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          )}
        </main>
      )}

      {authMode && (
        <div className="modal-backdrop" onMouseDown={() => setAuthMode(null)}>
          <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setAuthMode(null)}>×</button>
            <div className="modal-mark">{tx("أزهر")}</div>
            <h2>{authMode === 'login' ? copy.login : copy.register}</h2>
            {authMode === 'login' ? (
              <form onSubmit={submitLogin}>
                <label>{language === 'ar' ? 'البريد الإلكتروني' : 'Email'}<input name="email" type="email" required /></label>
                <label>{language === 'ar' ? 'كلمة المرور' : 'Password'}<PasswordField name="password" language={language} autoComplete="current-password" /></label>
                <button type="submit">{language === 'ar' ? 'دخول' : 'Sign in'}</button>
                <p>{language === 'ar' ? 'ليس لديك حساب؟' : 'New customer?' } <button type="button" onClick={() => setAuthMode('register')}>{copy.register}</button></p>
              </form>
            ) : (
              <form onSubmit={submitRegister}>
                <label>{language === 'ar' ? 'الاسم الكامل' : 'Full name'}<input name="name" required /></label>
                <label>{language === 'ar' ? 'البريد الإلكتروني' : 'Email'}<input name="email" type="email" required /></label>
                <label>{language === 'ar' ? 'رقم الهاتف' : 'Phone'}<input name="phone" required /></label>
                <label>{language === 'ar' ? 'كلمة المرور' : 'Password'}<PasswordField name="password" language={language} minLength={8} autoComplete="new-password" /></label>
                <button type="submit">{copy.register}</button>
                <p>{language === 'ar' ? 'لديك حساب؟' : 'Already have an account?' } <button type="button" onClick={() => setAuthMode('login')}>{copy.login}</button></p>
              </form>
            )}
          </section>
        </div>
      )}

      {orderId && (
        <div className="modal-backdrop" onMouseDown={() => setOrderId('')}>
          <section className="modal success-modal" onMouseDown={(event) => event.stopPropagation()}>
            <div className="success-check">✓</div><h2>{tx("تم تأكيد طلبك")}</h2><p>{tx("رقم الطلب: ")}<strong>{orderId.slice(0,8)}</strong></p><button onClick={() => setOrderId('')}>{tx("متابعة التسوق")}</button>
          </section>
        </div>
      )}
      <div className={`chat-widget ${chatOpen ? 'open' : ''}`}>
        {chatOpen && (
          <section className="chat-panel">
            <header>
              <span className="chat-header-mark" aria-hidden="true">{tx("أز")}</span>
              <div><b>{language === 'ar' ? 'مساعد سنتر الأزهر' : 'Al Azhar Center assistant'}</b><small>{language === 'ar' ? 'اسأل عن أقسام المركز' : 'Ask about our departments'}</small></div>
              <button onClick={() => setChatOpen(false)} aria-label={language === 'ar' ? 'إغلاق المساعد' : 'Close assistant'}>×</button>
            </header>
            <div className="chat-messages" aria-live="polite">
              {chatMessages.map((message,index) => (
                <div className={`chat-message ${message.from}`} key={index}>
                  <p className={message.from}>{message.text}</p>
                  {message.isError && <a className="chat-contact-link" href={`${whatsappUrl}?text=${whatsappQuestion}`} target="_blank" rel="noopener noreferrer">{language === 'ar' ? 'تواصل معنا عبر واتساب' : 'Contact us on WhatsApp'}</a>}
                </div>
              ))}
              {chatMessages.length === 1 && !chatBusy && (
                <div className="chat-prompts">
                  <small>{language === 'ar' ? 'ابدأ بسؤال' : 'Quick questions'}</small>
                  {(language === 'ar'
                    ? ['ما أقسام المركز؟', 'هل توجد كتب تجويد وقراءات؟', 'كيف أتواصل معكم؟']
                    : ['What departments do you have?', 'Do you have Tajweed books?', 'How can I contact you?']
                  ).map((prompt) => <button type="button" key={prompt} onClick={() => askChat(prompt)}>{prompt}<span aria-hidden="true">←</span></button>)}
                </div>
              )}
              {chatBusy && <p className="bot chat-typing" role="status">{language === 'ar' ? 'جارٍ الرد...' : 'Replying...'}</p>}
            </div>
            <form onSubmit={sendChat}><input name="message" placeholder={language === 'ar' ? 'اكتب سؤالك هنا...' : 'Write your question...'} disabled={chatBusy} required /><button type="submit" disabled={chatBusy} aria-label={language === 'ar' ? 'إرسال الرسالة' : 'Send message'}>➤</button></form>
          </section>
        )}
        {!chatOpen && <button className="chat-button" onClick={() => setChatOpen(true)} aria-label={language === 'ar' ? 'فتح مساعد سنتر الأزهر' : 'Open Al Azhar Center assistant'}><span aria-hidden="true">✦</span><i aria-hidden="true"></i></button>}
      </div>
      {toast && <div className="toast">{toast}</div>}
      <footer className="site-footer">
        <div className="footer-main">
          <div className="footer-brand-block">
            <button className="footer-brand" onClick={() => navigate('/','home')}>
              <img src={storeSettings.logo_url || '/logo.png'} alt="" />
              <span><strong>{tx(storeSettings.store_name || 'سنتــــر الأزهر')}</strong><small>{tx(storeSettings.store_location || 'شبين القناطر')}</small></span>
            </button>
            <p>{contentText(language, storeSettings, 'footer_description', 'سنتر متعدد الأقسام مختص بكل ما يخص الأزهر.')}</p>
            <div className="footer-social-links">
              <a href={whatsappUrl} target="_blank" rel="noopener noreferrer">{language === 'ar' ? 'واتساب' : 'WhatsApp'} <span aria-hidden="true">↗</span></a>
              <a href={`mailto:${storeEmail}`}>{language === 'ar' ? 'البريد الإلكتروني' : 'Email'} <span aria-hidden="true">↗</span></a>
              <a href={storeFacebook} target="_blank" rel="noopener noreferrer">{language === 'ar' ? 'فيسبوك' : 'Facebook'} <span aria-hidden="true">↗</span></a>
              <a href={storeInstagram} target="_blank" rel="noopener noreferrer">Instagram <span aria-hidden="true">↗</span></a>
              <a href={storeYoutube} target="_blank" rel="noopener noreferrer">YouTube <span aria-hidden="true">↗</span></a>
              <a href={storeMapUrl} target="_blank" rel="noopener noreferrer">{language === 'ar' ? 'الموقع على الخريطة' : 'Map location'} <span aria-hidden="true">↗</span></a>
            </div>
          </div>
          <div className="footer-link-column">
            <h2>{language === 'ar' ? 'تصفح الموقع' : 'Explore'}</h2>
            <button onClick={() => navigate('/','home')}>{copy.home}</button>
            <button onClick={openShop}>{language === 'ar' ? 'المتجر' : 'Store'}</button>
            <button onClick={() => navigate('/about','about')}>{copy.about}</button>
            <button onClick={() => navigate('/contact','contact')}>{copy.contact}</button>
          </div>
          <div className="footer-link-column">
            <h2>{language === 'ar' ? 'حسابك وطلبك' : 'Your account'}</h2>
            <button onClick={() => setView('cart')}>{copy.cart}</button>
            {user
              ? <button onClick={() => setView('account')}>{language === 'ar' ? 'حسابي' : 'My account'}</button>
              : <button onClick={() => setAuthMode('login')}>{copy.login}</button>}
            {user?.role === 'ADMIN' && <button onClick={openAdmin}>{language === 'ar' ? 'لوحة الأدمن' : 'Admin dashboard'}</button>}
          </div>
          <div className="footer-contact">
            <h2>{language === 'ar' ? 'تواصل معنا' : 'Get in touch'}</h2>
            <a href={whatsappUrl} target="_blank" rel="noopener noreferrer"><span>{storeSettings.store_whatsapp || '+20 1067920688'}</span><small>{language === 'ar' ? 'واتساب' : 'WhatsApp'}</small></a>
            <a href={`mailto:${storeEmail}`}><span>{storeEmail}</span><small>{language === 'ar' ? 'راسلنا عبر البريد' : 'Send us an email'}</small></a>
            <a href={storeMapUrl} target="_blank" rel="noopener noreferrer"><span>{language === 'ar' ? 'الموقع على الخريطة' : 'Map location'} ↗</span><small>{tx(storeAddress)}</small></a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} {tx(storeSettings.store_name || 'سنتــــر الأزهر')}. {language === 'ar' ? 'جميع الحقوق محفوظة.' : 'All rights reserved.'}</span>
          <span>{contentText(language, storeSettings, 'footer_text', 'الزي الأزهري • الكتب • الهدايا • مستلزمات العبادة')}</span>
        </div>
      </footer>
    </div>
  )
}

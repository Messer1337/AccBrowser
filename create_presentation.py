import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.enum.text import PP_ALIGN
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE

def create_oasis_presentation():
    prs = Presentation()
    # Set to widescreen 16:9
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    
    blank_layout = prs.slide_layouts[6]
    
    # Colors
    DARK_BG = RGBColor(15, 23, 42)       # #0F172A Slate 900
    CARD_BG = RGBColor(30, 41, 59)       # #1E293B Slate 800
    ACCENT_CYAN = RGBColor(6, 182, 212)   # #06B6D4 Cyan 500
    ACCENT_INDIGO = RGBColor(99, 102, 241)# #6366F1 Indigo 500
    ACCENT_GOLD = RGBColor(245, 158, 11)  # #F59E0B Amber 500
    TEXT_WHITE = RGBColor(248, 250, 252)  # #F8FAFC
    TEXT_MUTED = RGBColor(148, 163, 184) # #94A3B8
    BORDER_COLOR = RGBColor(51, 65, 85)  # #334155

    def apply_background(slide):
        background = slide.background
        fill = background.fill
        fill.solid()
        fill.fore_color.rgb = DARK_BG

    def add_header(slide, title_text, subtitle_text):
        # Category badge / Subtitle
        sub_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.4), Inches(11.7), Inches(0.4))
        tf_sub = sub_box.text_frame
        tf_sub.word_wrap = True
        p_sub = tf_sub.paragraphs[0]
        p_sub.text = subtitle_text.upper()
        p_sub.font.size = Pt(11)
        p_sub.font.bold = True
        p_sub.font.color.rgb = ACCENT_CYAN
        p_sub.font.name = "Arial"
        
        # Main Title
        title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.7), Inches(11.7), Inches(0.8))
        tf_title = title_box.text_frame
        tf_title.word_wrap = True
        p_title = tf_title.paragraphs[0]
        p_title.text = title_text
        p_title.font.size = Pt(24)
        p_title.font.bold = True
        p_title.font.color.rgb = TEXT_WHITE
        p_title.font.name = "Arial"

    def add_card(slide, left, top, width, height, bg_color=CARD_BG, border_color=BORDER_COLOR):
        shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, left, top, width, height)
        shape.fill.solid()
        shape.fill.fore_color.rgb = bg_color
        shape.line.color.rgb = border_color
        shape.line.width = Pt(1)
        return shape

    # ==================== SLIDE 1: TITLE SLIDE ====================
    slide1 = prs.slides.add_slide(blank_layout)
    apply_background(slide1)
    
    # Hero Card
    add_card(slide1, Inches(1.0), Inches(1.2), Inches(11.333), Inches(5.1), bg_color=RGBColor(24, 32, 52), border_color=ACCENT_CYAN)
    
    tb1 = slide1.shapes.add_textbox(Inches(1.5), Inches(1.8), Inches(10.333), Inches(4.0))
    tf1 = tb1.text_frame
    tf1.word_wrap = True
    
    p = tf1.paragraphs[0]
    p.text = "🏝️ OASIS BROWSER"
    p.font.size = Pt(40)
    p.font.bold = True
    p.font.color.rgb = ACCENT_CYAN
    p.font.name = "Arial"
    
    p2 = tf1.add_paragraph()
    p2.text = "Платформа мультиакаунтингу та ізольованих профілів нового покоління"
    p2.font.size = Pt(22)
    p2.font.bold = True
    p2.font.color.rgb = TEXT_WHITE
    p2.font.name = "Arial"
    p2.space_before = Pt(15)
    
    p3 = tf1.add_paragraph()
    p3.text = "Архітектура, технологічний стек, засоби антидетекції та специфіка застосування у ПсО (Психологічних операціях) і OSINT"
    p3.font.size = Pt(15)
    p3.font.color.rgb = TEXT_MUTED
    p3.font.name = "Arial"
    p3.space_before = Pt(20)

    # Footer meta
    p4 = tf1.add_paragraph()
    p4.text = "🔒 Конфіденційно • OASIS Team • 2026"
    p4.font.size = Pt(12)
    p4.font.color.rgb = ACCENT_GOLD
    p4.font.name = "Arial"
    p4.space_before = Pt(35)

    # ==================== SLIDE 2: PROJECT OVERVIEW ====================
    slide2 = prs.slides.add_slide(blank_layout)
    apply_background(slide2)
    add_header(slide2, "Огляд Проекту: Що таке OASIS Browser?", "01 / Концепція та Базовий Функціонал")
    
    features = [
        ("🛡️ Повний Anti-Detect", "Генерація та підміна цифрових відбитків (Canvas, WebGL, Audio, UA, Timezone). Повна ізоляція мережевого тунелю через проксі без витоків WebRTC."),
        ("⚡ Real-time Cloud Sync", "Централізована синхронізація профілів, кукі сесій та налаштувань між пристроями команди через Google Cloud Firestore."),
        ("👥 Командний Доступ (RBAC)", "Розподіл ролей (Admin / Worker). Керівник призначає доступні профілі конкретним операторам у 1 клік."),
        ("🔥 Авто-прогрів (Warmup)", "Фоновий фармінг довіри (Trust Score) акаунтів через автоматичне відвідування трастових ресурсів (Google, Reddit, Wikipedia)."),
        ("🎨 Преміальний UI", "4 сучасні темні теми (Cyber, Emerald, Sunset, Midnight) з Backdrop Blur та зручним управлінням сесіями."),
        ("🔒 Безпечний Бекап (.oasisbak)", "Експорт/імпорт бази профілів у зашифрований файл з використанням алгоритму AES-256-GCM та PBKDF2.")
    ]
    
    positions = [
        (Inches(0.8), Inches(1.6)), (Inches(4.8), Inches(1.6)), (Inches(8.8), Inches(1.6)),
        (Inches(0.8), Inches(4.4)), (Inches(4.8), Inches(4.4)), (Inches(8.8), Inches(4.4))
    ]
    
    for idx, (title, desc) in enumerate(features):
        pos_x, pos_y = positions[idx]
        add_card(slide2, pos_x, pos_y, Inches(3.7), Inches(2.5))
        
        tb = slide2.shapes.add_textbox(pos_x + Inches(0.2), pos_y + Inches(0.2), Inches(3.3), Inches(2.1))
        tf = tb.text_frame
        tf.word_wrap = True
        
        p = tf.paragraphs[0]
        p.text = title
        p.font.size = Pt(16)
        p.font.bold = True
        p.font.color.rgb = ACCENT_CYAN
        
        p_desc = tf.add_paragraph()
        p_desc.text = desc
        p_desc.font.size = Pt(12)
        p_desc.font.color.rgb = TEXT_MUTED
        p_desc.space_before = Pt(8)

    # ==================== SLIDE 3: ARCHITECTURE & STEALTH LOGIC ====================
    slide3 = prs.slides.add_slide(blank_layout)
    apply_background(slide3)
    add_header(slide3, "Технічна Архітектура та Логіка Захисту", "02 / Anti-Detect & Stealth Infrastructure")
    
    # Left Card - Tech Stack
    add_card(slide3, Inches(0.8), Inches(1.6), Inches(5.6), Inches(5.2))
    tb_arch = slide3.shapes.add_textbox(Inches(1.0), Inches(1.8), Inches(5.2), Inches(4.8))
    tf_arch = tb_arch.text_frame
    tf_arch.word_wrap = True
    
    p = tf_arch.paragraphs[0]
    p.text = "💻 Технологічний Стек"
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = ACCENT_INDIGO
    
    items_arch = [
        ("Core Architecture", "Electron 30 + Node.js (Main / Renderer IPC)"),
        ("Browser Automation", "Puppeteer-core + Stealth Plugin + Custom Patching"),
        ("Fingerprint Engine", "fingerprint-generator & fingerprint-injector (Chrome 120+)"),
        ("Cloud Infrastructure", "Firebase Auth + Cloud Firestore + Firebase Hosting"),
        ("Cryptography", "Crypto API, AES-256-GCM, SHA-256, PBKDF2")
    ]
    for label, val in items_arch:
        p_item = tf_arch.add_paragraph()
        p_item.text = f"• {label}: {val}"
        p_item.font.size = Pt(13)
        p_item.font.color.rgb = TEXT_WHITE
        p_item.space_before = Pt(10)

    # Right Card - Stealth Logic
    add_card(slide3, Inches(6.8), Inches(1.6), Inches(5.7), Inches(5.2))
    tb_stealth = slide3.shapes.add_textbox(Inches(7.0), Inches(1.8), Inches(5.3), Inches(4.8))
    tf_stealth = tb_stealth.text_frame
    tf_stealth.word_wrap = True
    
    p_s = tf_stealth.paragraphs[0]
    p_s.text = "🛡️ Механізми Ізоляції та Маскування"
    p_s.font.size = Pt(18)
    p_s.font.bold = True
    p_s.font.color.rgb = ACCENT_CYAN
    
    stealth_points = [
        ("Профільний карантин", "Кожен акаунт запускається у власному ізольованому `--user-data-dir` без спільного кешу чи IndexedDB."),
        ("Захист WebRTC IP", "Прапор `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` блокує витік справжнього IP оператора."),
        ("Fail-Closed Proxying", "Параметр `--proxy-bypass-list=<-loopback>` забороняє пряме підключення у разі збою проксі-сервера."),
        ("Емуляція Часового Поясу", "Часовий пояс браузера динамічно синхронізується з геолокацією IP-адреси проксі.")
    ]
    for title, detail in stealth_points:
        p_t = tf_stealth.add_paragraph()
        p_t.text = f"✔ {title}"
        p_t.font.size = Pt(14)
        p_t.font.bold = True
        p_t.font.color.rgb = TEXT_WHITE
        p_t.space_before = Pt(10)
        
        p_d = tf_stealth.add_paragraph()
        p_d.text = detail
        p_d.font.size = Pt(12)
        p_d.font.color.rgb = TEXT_MUTED

    # ==================== SLIDE 4: CLOUD SYNC & TEAM COLLABORATION ====================
    slide4 = prs.slides.add_slide(blank_layout)
    apply_background(slide4)
    add_header(slide4, "Хмарна Синхронізація та Управління Доступами", "03 / Real-Time Cloud Sync & RBAC")

    steps = [
        ("1. Real-Time Cloud Sync", "Всі зміни профілів, кукі та проксі зберігаються у Cloud Firestore та синхронізуються між операторами миттєво."),
        ("2. Active Holder Lock", "Індикатор активності попереджає команду, якщо профілем вже хтось користується, виключаючи дублювання сесій."),
        ("3. Smart Cookie Trimming", "Авто-очищення рекламного сміття (_ga, _fbp) гарантує дотримання квоти 1MB Firestore без втрати авториз-кукі."),
        ("4. Рольова Модель (RBAC)", "Admin має повний доступ та розподіляє профілі між Workers. Співробітник бачить тільки призначені йому акаунти.")
    ]

    for idx, (title, desc) in enumerate(steps):
        pos_y = Inches(1.6 + idx * 1.3)
        add_card(slide4, Inches(0.8), pos_y, Inches(11.7), Inches(1.1))
        
        tb = slide4.shapes.add_textbox(Inches(1.0), pos_y + Inches(0.15), Inches(11.3), Inches(0.8))
        tf = tb.text_frame
        tf.word_wrap = True
        
        p = tf.paragraphs[0]
        p.text = title
        p.font.size = Pt(16)
        p.font.bold = True
        p.font.color.rgb = ACCENT_CYAN
        
        p_d = tf.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(13)
        p_d.font.color.rgb = TEXT_WHITE
        p_d.space_before = Pt(4)

    # ==================== SLIDE 5: PSYOPS APPLICATIONS ====================
    slide5 = prs.slides.add_slide(blank_layout)
    apply_background(slide5)
    add_header(slide5, "Застосування в ПсО (Психологічних Операціях)", "04 / Tactical PSYOPS & Information Warfare")

    psyops_usecases = [
        ("🤖 Управління Сіткою Аватарів", "Можливість одночасного ведення сотень унікальних цифрових особистостей у FB, X (Twitter), Telegram, Reddit, TikTok без ризику ланцюгового бану (mass ban)."),
        ("🎭 Висока Довіра (High Trust Score)", "Завдяки модулю авто-прогріву (Warmup) акаунти мають реальну історію відвідувань Google/YouTube, що дозволяє проходити антифрод Meta/X як реальні користувачі."),
        ("🎯 Координовані Інформаційні Акції", "Розподіл акаунтів між операторами підрозділу дозволяє синхронно вкидати або посилювати потрібні нарративи у ворожому інфопросторі."),
        ("🛡️ Оперативна Безпека (OPSEC)", "Оператор ПсО захищений від деанонімізації: IP проксі, підмінені системи та відсутність прямих зв'язків між акаунтами унеможливлюють виявлення аналітиками противника.")
    ]

    for idx, (title, desc) in enumerate(psyops_usecases):
        row = idx // 2
        col = idx % 2
        pos_x = Inches(0.8 + col * 5.9)
        pos_y = Inches(1.6 + row * 2.7)
        
        add_card(slide5, pos_x, pos_y, Inches(5.6), Inches(2.4))
        
        tb = slide5.shapes.add_textbox(pos_x + Inches(0.2), pos_y + Inches(0.2), Inches(5.2), Inches(2.0))
        tf = tb.text_frame
        tf.word_wrap = True
        
        p = tf.paragraphs[0]
        p.text = title
        p.font.size = Pt(17)
        p.font.bold = True
        p.font.color.rgb = ACCENT_GOLD
        
        p_d = tf.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(13)
        p_d.font.color.rgb = TEXT_WHITE
        p_d.space_before = Pt(8)

    # ==================== SLIDE 6: OSINT & RECON APPLICATIONS ====================
    slide6 = prs.slides.add_slide(blank_layout)
    apply_background(slide6)
    add_header(slide6, "Застосування в OSINT та Розвідці", "05 / Intelligence & Covert Reconnaissance")

    add_card(slide6, Inches(0.8), Inches(1.6), Inches(11.7), Inches(5.2))
    tb_osint = slide6.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(11.1), Inches(4.8))
    tf_osint = tb_osint.text_frame
    tf_osint.word_wrap = True

    osint_points = [
        ("🔎 Незапобіжна Моніторингова Розвідка", "Спостереження за закрито-відкритими ворожими ресурсами, форумами та пабліками без ризику зв'язування сесій аналітиками ворожої контррозвідки."),
        ("🛡️ Ізоляція Розвідувальних Профілів", "Розвідувальна діяльність на різних цільових об'єктах проводиться з повністю незалежних браузерних профілів та гео-проксі, унеможливлюючи побудову графа розвідника."),
        ("📦 Швидка Передача Моніторингових Баз", "Завдяки зашифрованим бекапам (.oasisbak), оператор може передати сформований розвідувальний профіль (з відкритими сесіями та кукі) іншому аналітику за декілька секунд."),
        ("⚡ Протидія Анти-OSINT Системам", "Автоматична підміна TLS/JA3 відбитків та HTTP-заголовків дозволяє обходити захисти Cloudflare, Incapsula та спеціалізовані системи моніторингу заходів.")
    ]

    for title, desc in osint_points:
        p_t = tf_osint.add_paragraph()
        p_t.text = f"► {title}"
        p_t.font.size = Pt(16)
        p_t.font.bold = True
        p_t.font.color.rgb = ACCENT_CYAN
        p_t.space_before = Pt(10)

        p_d = tf_osint.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(13)
        p_d.font.color.rgb = TEXT_WHITE
        p_d.space_before = Pt(4)

    # ==================== SLIDE 7: SUMMARY & COMPARISON ====================
    slide7 = prs.slides.add_slide(blank_layout)
    apply_background(slide7)
    add_header(slide7, "Порівняння та Підсумок", "06 / Advantages & Conclusion")

    # Table comparing Commercial vs OASIS
    add_card(slide7, Inches(0.8), Inches(1.6), Inches(11.7), Inches(5.2))
    
    tb_sum = slide7.shapes.add_textbox(Inches(1.1), Inches(1.8), Inches(11.1), Inches(4.8))
    tf_sum = tb_sum.text_frame
    tf_sum.word_wrap = True

    p = tf_sum.paragraphs[0]
    p.text = "🏆 Ключові Переваги OASIS Browser для Спецпідрозділів:"
    p.font.size = Pt(18)
    p.font.bold = True
    p.font.color.rgb = ACCENT_GOLD

    summary_bullets = [
        ("100% Автономність та Безпека Даних", "Відсутність третіх сторін / комерційних серверів. База даних зберігається у власному Firebase інстансі з повним контролем правил розмежування."),
        ("Нульова Вартість Ліцензування", "Не вимагає щомісячної передплати (на відміну від AdsPower, GoLogin, Multilogin, які коштують від $100-$500/міс на команду)."),
        ("Спеціалізація під Задачі ПсО", "Інтегрований функціонал фонового прогріву акаунтів, швидкої зміни проксі, Active Holder та зашифрованого розповсюдження конфігів."),
        ("Готовність до Масштабування", "Можливість миттєвого додавання нових операторів та розгортання на macOS / Windows без складної конфігурації.")
    ]

    for title, desc in summary_bullets:
        p_t = tf_sum.add_paragraph()
        p_t.text = f"✔ {title}"
        p_t.font.size = Pt(15)
        p_t.font.bold = True
        p_t.font.color.rgb = ACCENT_CYAN
        p_t.space_before = Pt(12)

        p_d = tf_sum.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(13)
        p_d.font.color.rgb = TEXT_WHITE
        p_d.space_before = Pt(3)

    output_path = "/Users/daniuk/Desktop/my projects/AccBrowser/OASIS_Browser_PSYOPS_Presentation.pptx"
    prs.save(output_path)
    print(f"Presentation saved successfully at {output_path}")

if __name__ == "__main__":
    create_oasis_presentation()

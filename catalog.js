// Каталог STYX по прайсу «Профессионалы. Опт» от 1 октября 2026 (price-2026-10-01.csv).
// Сгенерирован из PDF-прайса: категории, артикулы, объёмы и оптовые цены — как в прайсе.
// Наличия в прайсе нет, поэтому все позиции помечены inStock: true.
// В production каталог, цены и остатки приходят с сервера (например, GET /api/catalog).
const CATALOG_PRICE_DATE = "01.10.2026";

const CATALOG_CATEGORIES = [
  { id: "all", label: "Все" },
  { id: "wrap-lotions", group: "pro-wraps", label: "Лосьоны для влажных пеленаний" },
  { id: "wrap-oils", group: "pro-wraps", label: "Аромамасла-подложки для пеленаний" },
  { id: "corsets", group: "pro-wraps", label: "Корсеты" },
  { id: "thermo-gels", group: "pro-wraps", label: "Термоактивные гели" },
  { id: "wrap-salts", group: "pro-wraps", label: "Соль морская холодная и горячая" },
  { id: "massage-oils", group: "pro-wraps", label: "Массажные масла с эфирной формулой" },
  { id: "essential-oils", group: "aroma-care", label: "Эфирные масла" },
  { id: "oil-blends", group: "aroma-care", label: "Смеси эфирных масел" },
  { id: "dead-sea-salts", group: "aroma-care", label: "Соли Мертвого моря" },
  { id: "body-peeling", group: "aroma-care", label: "Пилинг для тела" },
  { id: "base-oils", group: "aroma-care", label: "Базисные масла холодного отжима" },
  { id: "soap", group: "aroma-care", label: "Натуральное мыло Krautergarten" },
  { id: "ampoules", group: "aroma-care", label: "Цитоактивные ампулы" },
  { id: "chin-min", group: "aroma-care", label: "Chin Min — многофункциональная косметика" },
  { id: "universal", group: "aroma-care", label: "Универсальные кремы и гели" },
  { id: "green-tea", group: "aroma-care", label: "Зеленый чай — антистресс" },
  { id: "green-asia", group: "aroma-care", label: "Серия «Green Asia»" },
  { id: "alginate-masks", group: "aroma-care", label: "Альгинатные маски" },
  { id: "secret-age", group: "aroma-care", label: "Серия «Secret Age»" },
  { id: "concentrates", group: "aroma-care", label: "Активные концентраты в маски" },
  { id: "accessories", group: "aroma-care", label: "Сопутствующие товары" }
];

// Группы для списка категорий: разделы прайса сгруппированы по назначению.
const CATALOG_GROUPS = [
  { id: "pro-wraps", label: "Проф. косметика для термообёртываний и виски-пеленания" },
  { id: "aroma-care", label: "Ароматерапия и уход" }
];

const CATALOG = [
  {
    id: "essential-oils-anis",
    category: "essential-oils",
    name: "Анис",
    variants: [
      { sku: "15000", volume: "10 мл", price: 976, inStock: true }
    ]
  },
  {
    id: "essential-oils-apelsin",
    category: "essential-oils",
    name: "Апельсин",
    variants: [
      { sku: "15320", volume: "10 мл", price: 915, inStock: true }
    ]
  },
  {
    id: "essential-oils-bazilik",
    category: "essential-oils",
    name: "Базилик",
    variants: [
      { sku: "15030", volume: "10 мл", price: 1708, inStock: true }
    ]
  },
  {
    id: "essential-oils-bergamot",
    category: "essential-oils",
    name: "Бергамот",
    variants: [
      { sku: "15040", volume: "10 мл", price: 2196, inStock: true }
    ]
  },
  {
    id: "essential-oils-verbena",
    category: "essential-oils",
    name: "Вербена",
    variants: [
      { sku: "5790", volume: "10 мл", price: 21838, inStock: true }
    ]
  },
  {
    id: "essential-oils-gvozdika",
    category: "essential-oils",
    name: "Гвоздика",
    variants: [
      { sku: "15290", volume: "10 мл", price: 732, inStock: true }
    ]
  },
  {
    id: "essential-oils-geran",
    category: "essential-oils",
    name: "Герань",
    variants: [
      { sku: "15120", volume: "10 мл", price: 1891, inStock: true }
    ]
  },
  {
    id: "essential-oils-greypfrut",
    category: "essential-oils",
    name: "Грейпфрут",
    variants: [
      { sku: "15130", volume: "10 мл", price: 1464, inStock: true }
    ]
  },
  {
    id: "essential-oils-dushitsa",
    category: "essential-oils",
    name: "Душица",
    variants: [
      { sku: "15340", volume: "10 мл", price: 1708, inStock: true }
    ]
  },
  {
    id: "essential-oils-el",
    category: "essential-oils",
    name: "Ель",
    variants: [
      { sku: "15110", volume: "10 мл", price: 915, inStock: true }
    ]
  },
  {
    id: "essential-oils-zhasmin",
    category: "essential-oils",
    name: "Жасмин",
    variants: [
      { sku: "5390", volume: "10 мл", price: 26108, inStock: true }
    ]
  },
  {
    id: "essential-oils-ilang-ilang",
    category: "essential-oils",
    name: "Иланг-иланг",
    variants: [
      { sku: "15520", volume: "10 мл", price: 4758, inStock: true }
    ]
  },
  {
    id: "essential-oils-kayaput",
    category: "essential-oils",
    name: "Каяпут",
    variants: [
      { sku: "15050", volume: "10 мл", price: 1342, inStock: true }
    ]
  },
  {
    id: "essential-oils-kedr",
    category: "essential-oils",
    name: "Кедр",
    variants: [
      { sku: "15540", volume: "10 мл", price: 1037, inStock: true }
    ]
  },
  {
    id: "essential-oils-kiparis",
    category: "essential-oils",
    name: "Кипарис",
    variants: [
      { sku: "15570", volume: "10 мл", price: 1403, inStock: true }
    ]
  },
  {
    id: "essential-oils-koritsa",
    category: "essential-oils",
    name: "Корица",
    variants: [
      { sku: "15550", volume: "10 мл", price: 2196, inStock: true }
    ]
  },
  {
    id: "essential-oils-lavanda",
    category: "essential-oils",
    name: "Лаванда",
    variants: [
      { sku: "15200", volume: "10 мл", price: 1464, inStock: true }
    ]
  },
  {
    id: "essential-oils-ladan",
    category: "essential-oils",
    name: "Ладан",
    variants: [
      { sku: "15510", volume: "10 мл", price: 3660, inStock: true }
    ]
  },
  {
    id: "essential-oils-levzeya",
    category: "essential-oils",
    name: "Левзея",
    variants: [
      { sku: "15610", volume: "10 мл", price: 1098, inStock: true }
    ]
  },
  {
    id: "essential-oils-lemongrass",
    category: "essential-oils",
    name: "Лемонграсс",
    variants: [
      { sku: "15210", volume: "10 мл", price: 854, inStock: true }
    ]
  },
  {
    id: "essential-oils-limett",
    category: "essential-oils",
    name: "Лиметт",
    variants: [
      { sku: "15220", volume: "10 мл", price: 1098, inStock: true }
    ]
  },
  {
    id: "essential-oils-limon",
    category: "essential-oils",
    name: "Лимон",
    variants: [
      { sku: "15560", volume: "10 мл", price: 915, inStock: true }
    ]
  },
  {
    id: "essential-oils-mandarin",
    category: "essential-oils",
    name: "Мандарин",
    variants: [
      { sku: "15240", volume: "10 мл", price: 1403, inStock: true }
    ]
  },
  {
    id: "essential-oils-melissa",
    category: "essential-oils",
    name: "Мелисса",
    variants: [
      { sku: "15250", volume: "10 мл", price: 1159, inStock: true }
    ]
  },
  {
    id: "essential-oils-mirt",
    category: "essential-oils",
    name: "Мирт",
    variants: [
      { sku: "577", volume: "10 мл", price: 3294, inStock: true }
    ]
  },
  {
    id: "essential-oils-mozhzhevelnik",
    category: "essential-oils",
    name: "Можжевельник",
    variants: [
      { sku: "15500", volume: "10 мл", price: 2196, inStock: true }
    ]
  },
  {
    id: "essential-oils-myata",
    category: "essential-oils",
    name: "Мята",
    variants: [
      { sku: "15390", volume: "10 мл", price: 915, inStock: true }
    ]
  },
  {
    id: "essential-oils-neroli",
    category: "essential-oils",
    name: "Нероли",
    variants: [
      { sku: "15300", volume: "10 мл", price: 2562, inStock: true }
    ]
  },
  {
    id: "essential-oils-palmaroza",
    category: "essential-oils",
    name: "Пальмароза",
    variants: [
      { sku: "15350", volume: "10 мл", price: 1098, inStock: true }
    ]
  },
  {
    id: "essential-oils-pachuli",
    category: "essential-oils",
    name: "Пачули",
    variants: [
      { sku: "15360", volume: "10 мл", price: 1708, inStock: true }
    ]
  },
  {
    id: "essential-oils-perets-chernyy",
    category: "essential-oils",
    name: "Перец черный",
    variants: [
      { sku: "15380", volume: "10 мл", price: 1220, inStock: true }
    ]
  },
  {
    id: "essential-oils-petit-greyn",
    category: "essential-oils",
    name: "Петит грейн",
    variants: [
      { sku: "15370", volume: "10 мл", price: 1464, inStock: true }
    ]
  },
  {
    id: "essential-oils-roza",
    category: "essential-oils",
    name: "Роза",
    variants: [
      { sku: "15408", volume: "1 мл", price: 4636, inStock: true },
      { sku: "5411", volume: "10 мл", price: 36234, inStock: true }
    ]
  },
  {
    id: "essential-oils-rozmarin",
    category: "essential-oils",
    name: "Розмарин",
    variants: [
      { sku: "15420", volume: "10 мл", price: 1220, inStock: true }
    ]
  },
  {
    id: "essential-oils-rozovoe-derevo",
    category: "essential-oils",
    name: "Розовое дерево",
    variants: [
      { sku: "15410", volume: "10 мл", price: 1830, inStock: true }
    ]
  },
  {
    id: "essential-oils-sandal",
    category: "essential-oils",
    name: "Сандал",
    variants: [
      { sku: "52010", volume: "10 мл", price: 18056, inStock: true }
    ]
  },
  {
    id: "essential-oils-sosna",
    category: "essential-oils",
    name: "Сосна",
    variants: [
      { sku: "15600", volume: "10 мл", price: 2196, inStock: true }
    ]
  },
  {
    id: "essential-oils-fenhel",
    category: "essential-oils",
    name: "Фенхель",
    variants: [
      { sku: "15100", volume: "10 мл", price: 976, inStock: true }
    ]
  },
  {
    id: "essential-oils-tsitronella",
    category: "essential-oils",
    name: "Цитронелла",
    variants: [
      { sku: "15070", volume: "10 мл", price: 793, inStock: true }
    ]
  },
  {
    id: "essential-oils-chabrets",
    category: "essential-oils",
    name: "Чабрец",
    variants: [
      { sku: "15470", volume: "10 мл", price: 1830, inStock: true }
    ]
  },
  {
    id: "essential-oils-chaynoe-derevo",
    category: "essential-oils",
    name: "Чайное дерево",
    variants: [
      { sku: "15460", volume: "10 мл", price: 1220, inStock: true }
    ]
  },
  {
    id: "essential-oils-shalfey",
    category: "essential-oils",
    name: "Шалфей",
    variants: [
      { sku: "15430", volume: "10 мл", price: 1464, inStock: true }
    ]
  },
  {
    id: "essential-oils-evkalipt",
    category: "essential-oils",
    name: "Эвкалипт",
    variants: [
      { sku: "15090", volume: "10 мл", price: 793, inStock: true }
    ]
  },
  {
    id: "oil-blends-smes-magicheskaya-lyubov",
    category: "oil-blends",
    name: "Смесь «Магическая любовь»",
    variants: [
      { sku: "566", volume: "10 мл", price: 1525, inStock: true }
    ]
  },
  {
    id: "oil-blends-smes-noch-lyubvi",
    category: "oil-blends",
    name: "Смесь «Ночь любви»",
    variants: [
      { sku: "16120", volume: "10 мл", price: 1525, inStock: true }
    ]
  },
  {
    id: "oil-blends-smes-ot-stressa",
    category: "oil-blends",
    name: "Смесь «От стресса»",
    variants: [
      { sku: "563", volume: "10 мл", price: 1525, inStock: true }
    ]
  },
  {
    id: "oil-blends-smes-svet-dushi",
    category: "oil-blends",
    name: "Смесь «Свет души»",
    variants: [
      { sku: "16150", volume: "10 мл", price: 1525, inStock: true }
    ]
  },
  {
    id: "oil-blends-smes-solnechnoe-siyanie",
    category: "oil-blends",
    name: "Смесь «Солнечное сияние»",
    variants: [
      { sku: "16100", volume: "10 мл", price: 1525, inStock: true }
    ]
  },
  {
    id: "oil-blends-smes-fortuna",
    category: "oil-blends",
    name: "Смесь «Фортуна»",
    variants: [
      { sku: "16130", volume: "10 мл", price: 1464, inStock: true }
    ]
  },
  {
    id: "oil-blends-smes-erotika",
    category: "oil-blends",
    name: "Смесь «Эротика»",
    variants: [
      { sku: "565", volume: "10 мл", price: 1525, inStock: true }
    ]
  },
  {
    id: "wrap-lotions-loson-led",
    category: "wrap-lotions",
    name: "Лосьон «Лед»",
    variants: [
      { sku: "82014", volume: "200 мл", price: 3172, inStock: true },
      { sku: "82019", volume: "400 мл", price: 5490, inStock: true }
    ]
  },
  {
    id: "wrap-lotions-loson-lepestki-rozy",
    category: "wrap-lotions",
    name: "Лосьон «Лепестки розы»",
    variants: [
      { sku: "82054", volume: "200 мл", price: 3172, inStock: true },
      { sku: "82059", volume: "400 мл", price: 5490, inStock: true }
    ]
  },
  {
    id: "wrap-lotions-loson-vodorosli",
    category: "wrap-lotions",
    name: "Лосьон «Водоросли»",
    variants: [
      { sku: "82034", volume: "200 мл", price: 3172, inStock: true },
      { sku: "82039", volume: "400 мл", price: 5490, inStock: true }
    ]
  },
  {
    id: "wrap-lotions-loson-neroli-apelsin",
    category: "wrap-lotions",
    name: "Лосьон «Нероли» (апельсин)",
    variants: [
      { sku: "82044", volume: "200 мл", price: 3172, inStock: true },
      { sku: "82049", volume: "400 мл", price: 5490, inStock: true }
    ]
  },
  {
    id: "wrap-lotions-loson-tsentella-intensiv",
    category: "wrap-lotions",
    name: "Лосьон «Центелла-интенсив»",
    variants: [
      { sku: "82064", volume: "200 мл", price: 3416, inStock: true },
      { sku: "82069", volume: "400 мл", price: 5612, inStock: true }
    ]
  },
  {
    id: "wrap-lotions-loson-lifting-aziya",
    category: "wrap-lotions",
    name: "Лосьон «Лифтинг» (Азия)",
    variants: [
      { sku: "0431", volume: "1000 мл", price: 12566, inStock: true }
    ]
  },
  {
    id: "wrap-oils-aromamaslo-apelsin",
    category: "wrap-oils",
    name: "Аромамасло «Апельсин»",
    variants: [
      { sku: "82164", volume: "200 мл", price: 3782, inStock: true }
    ]
  },
  {
    id: "wrap-oils-aromamaslo-antitsellyulit-ekstra",
    category: "wrap-oils",
    name: "Аромамасло «Антицеллюлит экстра»",
    variants: [
      { sku: "82124", volume: "200 мл", price: 3782, inStock: true }
    ]
  },
  {
    id: "wrap-oils-aromamaslo-limon",
    category: "wrap-oils",
    name: "Аромамасло «Лимон»",
    variants: [
      { sku: "82154", volume: "200 мл", price: 3782, inStock: true }
    ]
  },
  {
    id: "wrap-oils-aromamaslo-roza",
    category: "wrap-oils",
    name: "Аромамасло «Роза»",
    variants: [
      { sku: "82144", volume: "200 мл", price: 3782, inStock: true }
    ]
  },
  {
    id: "corsets-gel-korset-koritsa",
    category: "corsets",
    name: "Гель-корсет «Корица»",
    variants: [
      { sku: "83123", volume: "150 мл", price: 2806, inStock: true },
      { sku: "83126", volume: "1000 мл", price: 14640, inStock: true }
    ]
  },
  {
    id: "corsets-gel-lifting-forte",
    category: "corsets",
    name: "Гель «Лифтинг форте»",
    variants: [
      { sku: "83133", volume: "150 мл", price: 2806, inStock: true },
      { sku: "83136", volume: "1000 мл", price: 14640, inStock: true }
    ]
  },
  {
    id: "corsets-gel-korset-svezhest-ledyanoy",
    category: "corsets",
    name: "Гель-корсет «Свежесть» (ледяной)",
    variants: [
      { sku: "83053", volume: "150 мл", price: 2806, inStock: true },
      { sku: "83056", volume: "1000 мл", price: 14762, inStock: true }
    ]
  },
  {
    id: "corsets-gel-korset-zhar-i-holod",
    category: "corsets",
    name: "Гель-корсет «Жар и холод»",
    variants: [
      { sku: "83063", volume: "150 мл", price: 3050, inStock: true },
      { sku: "83066", volume: "1000 мл", price: 15372, inStock: true }
    ]
  },
  {
    id: "corsets-krem-korset-ikra",
    category: "corsets",
    name: "Крем-корсет «Икра»",
    variants: [
      { sku: "082", volume: "150 мл", price: 3416, inStock: true },
      { sku: "0821", volume: "1000 мл", price: 14274, inStock: true }
    ]
  },
  {
    id: "corsets-krem-korset-aloe-vera",
    category: "corsets",
    name: "Крем-корсет «Алоэ вера»",
    variants: [
      { sku: "83403", volume: "150 мл", price: 2928, inStock: true },
      { sku: "83406", volume: "1000 мл", price: 13542, inStock: true }
    ]
  },
  {
    id: "corsets-krem-korset-vodorosli",
    category: "corsets",
    name: "Крем-корсет «Водоросли»",
    variants: [
      { sku: "83113", volume: "150 мл", price: 2928, inStock: true },
      { sku: "83116", volume: "1000 мл", price: 13420, inStock: true }
    ]
  },
  {
    id: "corsets-krem-korset-konturnyy",
    category: "corsets",
    name: "Крем-корсет «Контурный»",
    variants: [
      { sku: "83043", volume: "150 мл", price: 2989, inStock: true },
      { sku: "83046", volume: "1000 мл", price: 13420, inStock: true }
    ]
  },
  {
    id: "wrap-salts-sol-morskaya-s-ohlazhdayuschim-effektom",
    category: "wrap-salts",
    name: "Соль морская с охлаждающим эффектом",
    variants: [
      { sku: "82073", volume: "150 г", price: 2928, inStock: true },
      { sku: "82076", volume: "1000 г", price: 9638, inStock: true }
    ]
  },
  {
    id: "wrap-salts-sol-morskaya-s-razogrevayuschim-effektom",
    category: "wrap-salts",
    name: "Соль морская с разогревающим эффектом",
    variants: [
      { sku: "82083", volume: "150 г", price: 2928, inStock: true },
      { sku: "82086", volume: "1000 г", price: 9638, inStock: true }
    ]
  },
  {
    id: "dead-sea-salts-sol-dlya-vann-detox",
    category: "dead-sea-salts",
    name: "Соль для ванн «Detox»",
    variants: [
      { sku: "83235", volume: "500 г", price: 1830, inStock: true }
    ]
  },
  {
    id: "thermo-gels-tsel-gel-myagkiy-cello-gel-soft",
    category: "thermo-gels",
    name: "Цель-гель «Мягкий» (Cello Gel Soft)",
    variants: [
      { sku: "81013", volume: "150 мл", price: 2684, inStock: true },
      { sku: "81016", volume: "1000 мл", price: 14152, inStock: true }
    ]
  },
  {
    id: "thermo-gels-tsel-gel-sredniy-cello-gel-medium",
    category: "thermo-gels",
    name: "Цель-гель «Средний» (Cello Gel Medium)",
    variants: [
      { sku: "81023", volume: "150 мл", price: 2684, inStock: true },
      { sku: "81026", volume: "1000 мл", price: 14396, inStock: true }
    ]
  },
  {
    id: "thermo-gels-tsel-gel-silnyy-cello-gel-strong",
    category: "thermo-gels",
    name: "Цель-гель «Сильный» (Cello Gel Strong)",
    variants: [
      { sku: "81033", volume: "150 мл", price: 2684, inStock: true },
      { sku: "81036", volume: "1000 мл", price: 14396, inStock: true }
    ]
  },
  {
    id: "thermo-gels-tsel-gel-ekstra-cello-gel-extra",
    category: "thermo-gels",
    name: "Цель-гель «Экстра» (Cello Gel Extra)",
    variants: [
      { sku: "81043", volume: "150 мл", price: 2806, inStock: true },
      { sku: "81046", volume: "1000 мл", price: 15860, inStock: true }
    ]
  },
  {
    id: "thermo-gels-tsel-gel-goryachiy-hot-slim-tsentella",
    category: "thermo-gels",
    name: "Цель-гель горячий «Hot Slim» (центелла)",
    variants: [
      { sku: "43063", volume: "150 мл", price: 2806, inStock: true }
    ]
  },
  {
    id: "thermo-gels-tsel-gel-tsentella-i-flerdoranzh",
    category: "thermo-gels",
    name: "Цель-гель «Центелла и флердоранж»",
    variants: [
      { sku: "81056", volume: "1000 мл", price: 14762, inStock: true }
    ]
  },
  {
    id: "thermo-gels-tsel-gel-holodnyy-cool-slimming",
    category: "thermo-gels",
    name: "Цель-гель «Холодный» (Cool Slimming)",
    variants: [
      { sku: "81083", volume: "150 мл", price: 2806, inStock: true },
      { sku: "81086", volume: "1000 мл", price: 15372, inStock: true }
    ]
  },
  {
    id: "body-peeling-piling-s-abrikos-kostochkoy-honeymoon",
    category: "body-peeling",
    name: "Пилинг с абрикос. косточкой Honeymoon",
    variants: [
      { sku: "84736", volume: "1000 мл", price: 7808, inStock: true }
    ]
  },
  {
    id: "massage-oils-massazhnoe-maslo-antitsellyulit",
    category: "massage-oils",
    name: "Массажное масло «Антицеллюлит»",
    variants: [
      { sku: "84176", volume: "1000 мл", price: 9394, inStock: true }
    ]
  },
  {
    id: "massage-oils-massazhnoe-maslo-37-trav",
    category: "massage-oils",
    name: "Массажное масло «37 трав»",
    variants: [
      { sku: "84156", volume: "1000 мл", price: 9394, inStock: true }
    ]
  },
  {
    id: "massage-oils-massazhnoe-maslo-zhiznennyy-tonus",
    category: "massage-oils",
    name: "Массажное масло «Жизненный тонус»",
    variants: [
      { sku: "84136", volume: "1000 мл", price: 9394, inStock: true }
    ]
  },
  {
    id: "massage-oils-maslo-massazhnoe-kamasutra",
    category: "massage-oils",
    name: "Масло массажное «Камасутра»",
    variants: [
      { sku: "122", volume: "200 мл", price: 3782, inStock: true }
    ]
  },
  {
    id: "base-oils-maslo-vinogradnyh-kostochek-profi",
    category: "base-oils",
    name: "Масло виноградных косточек профи",
    variants: [
      { sku: "84386", volume: "1000 мл", price: 5490, inStock: true }
    ]
  },
  {
    id: "base-oils-maslo-massazhnoe-neytralnoe",
    category: "base-oils",
    name: "Масло массажное нейтральное",
    variants: [
      { sku: "84396", volume: "1000 мл", price: 4514, inStock: true }
    ]
  },
  {
    id: "soap-mylo-verbena",
    category: "soap",
    name: "Мыло «Вербена»",
    variants: [
      { sku: "13281\u0427", volume: "100 г", price: 671, inStock: true }
    ]
  },
  {
    id: "soap-mylo-yogurt",
    category: "soap",
    name: "Мыло «Йогурт»",
    variants: [
      { sku: "12252", volume: "100 г", price: 671, inStock: true }
    ]
  },
  {
    id: "soap-mylo-chaynoe-derevo",
    category: "soap",
    name: "Мыло «Чайное дерево»",
    variants: [
      { sku: "13271", volume: "100 г", price: 671, inStock: true }
    ]
  },
  {
    id: "soap-mylo-shalfey",
    category: "soap",
    name: "Мыло «Шалфей»",
    variants: [
      { sku: "12262", volume: "100 г", price: 671, inStock: true }
    ]
  },
  {
    id: "ampoules-transdermalnye-ampuly-anti-aging",
    category: "ampoules",
    name: "Трансдермальные ампулы Anti-Aging",
    variants: [
      { sku: "85209", volume: "10×2 мл", price: 5246, inStock: true }
    ]
  },
  {
    id: "ampoules-kontsentrat-v-ampulah-vitamin-c",
    category: "ampoules",
    name: "Концентрат в ампулах «Витамин C»",
    variants: [
      { sku: "85258", volume: "10×2 мл", price: 3660, inStock: true }
    ]
  },
  {
    id: "ampoules-transdermalnye-ampuly-beauty-express",
    category: "ampoules",
    name: "Трансдермальные ампулы Beauty Express",
    variants: [
      { sku: "85279", volume: "10×2 мл", price: 5246, inStock: true }
    ]
  },
  {
    id: "ampoules-transdermalnye-ampuly-phyto-vital",
    category: "ampoules",
    name: "Трансдермальные ампулы Phyto Vital",
    variants: [
      { sku: "85289", volume: "10×2 мл", price: 5124, inStock: true }
    ]
  },
  {
    id: "ampoules-transdermalnye-ampuly-beauty-tent",
    category: "ampoules",
    name: "Трансдермальные ампулы Beauty Tent",
    variants: [
      { sku: "85299", volume: "10×2 мл", price: 3782, inStock: true }
    ]
  },
  {
    id: "ampoules-lifting-ampuly-s-gialuronom",
    category: "ampoules",
    name: "Лифтинг ампулы с гиалуроном",
    variants: [
      { sku: "85709", volume: "10×2 мл", price: 5246, inStock: true }
    ]
  },
  {
    id: "chin-min-chin-min-gel-dlya-massazha",
    category: "chin-min",
    name: "Chin-Min гель для массажа",
    variants: [
      { sku: "18303", volume: "150 мл", price: 2928, inStock: true }
    ]
  },
  {
    id: "chin-min-chin-min-loson",
    category: "chin-min",
    name: "Chin-Min лосьон",
    variants: [
      { sku: "18312", volume: "100 мл", price: 3904, inStock: true }
    ]
  },
  {
    id: "chin-min-chin-min-sportivnyy-flyuid",
    category: "chin-min",
    name: "Chin-Min спортивный флюид",
    variants: [
      { sku: "18322", volume: "100 мл", price: 1464, inStock: true }
    ]
  },
  {
    id: "chin-min-chin-min-sportivnyy-sprey",
    category: "chin-min",
    name: "Chin-Min спортивный спрей",
    variants: [
      { sku: "18332", volume: "100 мл", price: 1952, inStock: true }
    ]
  },
  {
    id: "universal-krem-koziy-mnogofunktsionalnyy",
    category: "universal",
    name: "Крем козий многофункциональный",
    variants: [
      { sku: "17553", volume: "150 мл", price: 4514, inStock: true }
    ]
  },
  {
    id: "universal-bazisnyy-massazhnyy-krem",
    category: "universal",
    name: "Базисный массажный крем",
    variants: [
      { sku: "84015", volume: "500 мл", price: 4636, inStock: true }
    ]
  },
  {
    id: "green-tea-dnevnoy-krem-dlya-kombi-kozhi",
    category: "green-tea",
    name: "Дневной крем для комби. кожи",
    variants: [
      { sku: "42021", volume: "50 мл", price: 2806, inStock: true }
    ]
  },
  {
    id: "green-tea-nochnoy-krem-dlya-kombi-kozhi",
    category: "green-tea",
    name: "Ночной крем для комби. кожи",
    variants: [
      { sku: "42031", volume: "50 мл", price: 3050, inStock: true }
    ]
  },
  {
    id: "green-tea-gibiskus-osvezhayuschaya-maska",
    category: "green-tea",
    name: "Гибискус освежающая маска",
    variants: [
      { sku: "42003", volume: "150 мл", price: 4392, inStock: true }
    ]
  },
  {
    id: "green-tea-ehinatseya-uspokivayuschaya-maska",
    category: "green-tea",
    name: "Эхинацея успокивающая маска",
    variants: [
      { sku: "42013", volume: "150 мл", price: 4392, inStock: true }
    ]
  },
  {
    id: "green-tea-sos-applikator-ot-sypi-razdrazheniya",
    category: "green-tea",
    name: "SOS-аппликатор от сыпи, раздражения",
    variants: [
      { sku: "86509", volume: "8 мл", price: 1830, inStock: true }
    ]
  },
  {
    id: "green-asia-krem-maska-primula-vechernyaya-enotera",
    category: "green-asia",
    name: "Крем-маска примула вечерняя (энотера)",
    variants: [
      { sku: "41003", volume: "150 мл", price: 5612, inStock: true }
    ]
  },
  {
    id: "green-asia-ochischayuschie-slivki",
    category: "green-asia",
    name: "Очищающие сливки",
    variants: [
      { sku: "40114", volume: "200 мл", price: 2562, inStock: true }
    ]
  },
  {
    id: "green-asia-ochischayuschiy-tonik",
    category: "green-asia",
    name: "Очищающий тоник",
    variants: [
      { sku: "40124", volume: "200 мл", price: 2562, inStock: true },
      { sku: "40125", volume: "500 мл", price: 5124, inStock: true }
    ]
  },
  {
    id: "green-asia-piling-obnovlenie-i-gladkost",
    category: "green-asia",
    name: "Пилинг «Обновление и гладкость»",
    variants: [
      { sku: "40131", volume: "50 мл", price: 2562, inStock: true }
    ]
  },
  {
    id: "alginate-masks-spirulina-peel-off-mask-alginat-maska",
    category: "alginate-masks",
    name: "«Spirulina Peel Off Mask» альгинат маска",
    variants: [
      { sku: "86806", volume: "333 г", price: 7076, inStock: true }
    ]
  },
  {
    id: "alginate-masks-cool-peel-off-alginatnaya-maska",
    category: "alginate-masks",
    name: "«Cool Peel Off» альгинатная маска",
    variants: [
      { sku: "86516", volume: "333 г", price: 7320, inStock: true }
    ]
  },
  {
    id: "alginate-masks-liftingovaya-shokoladno-alginat-maska",
    category: "alginate-masks",
    name: "Лифтинговая шоколадно-альгинат. маска",
    variants: [
      { sku: "86776", volume: "333 г", price: 8418, inStock: true }
    ]
  },
  {
    id: "secret-age-ochischayuschie-slivki-s-ekstraktom-malv",
    category: "secret-age",
    name: "Очищающие сливки с экстрактом мальвы",
    variants: [
      { sku: "86705", volume: "500 мл", price: 5856, inStock: true }
    ]
  },
  {
    id: "secret-age-tonik-dlya-litsa-s-rozovoy-vodoy",
    category: "secret-age",
    name: "Тоник для лица с розовой водой",
    variants: [
      { sku: "86715", volume: "500 мл", price: 5856, inStock: true }
    ]
  },
  {
    id: "secret-age-secret-age-maska-ananas",
    category: "secret-age",
    name: "Secret Age маска ананас",
    variants: [
      { sku: "86723", volume: "150 мл", price: 5246, inStock: true }
    ]
  },
  {
    id: "secret-age-secret-age-maska-liftingovaya",
    category: "secret-age",
    name: "Secret Age маска лифтинговая",
    variants: [
      { sku: "86733", volume: "150 мл", price: 7198, inStock: true }
    ]
  },
  {
    id: "secret-age-secret-age-maska-vitaminnaya",
    category: "secret-age",
    name: "Secret Age маска витаминная",
    variants: [
      { sku: "86743", volume: "150 мл", price: 7198, inStock: true }
    ]
  },
  {
    id: "secret-age-secret-age-maska-s-organik-rozoy",
    category: "secret-age",
    name: "Secret Age маска с органик розой",
    variants: [
      { sku: "86753", volume: "150 мл", price: 6588, inStock: true }
    ]
  },
  {
    id: "concentrates-kontsentrat-dlya-zreloy-kozhi-steklo",
    category: "concentrates",
    name: "Концентрат для зрелой кожи стекло",
    variants: [
      { sku: "85170", volume: "20 мл", price: 1342, inStock: true }
    ]
  },
  {
    id: "concentrates-kontsentrat-dlya-smeshannoy-kozhi",
    category: "concentrates",
    name: "Концентрат для смешанной кожи",
    variants: [
      { sku: "85150", volume: "20 мл", price: 1220, inStock: true }
    ]
  },
  {
    id: "concentrates-kontsentrat-dlya-suhoy-kozhi",
    category: "concentrates",
    name: "Концентрат для сухой кожи",
    variants: [
      { sku: "85140", volume: "20 мл", price: 1342, inStock: true }
    ]
  },
  {
    id: "concentrates-kontsentrat-dlya-problemnoy-kozhi",
    category: "concentrates",
    name: "Концентрат для проблемной кожи",
    variants: [
      { sku: "85160", volume: "20 мл", price: 1342, inStock: true }
    ]
  },
  {
    id: "accessories-aromalampa-aroma-derm",
    category: "accessories",
    name: "Аромалампа «Арома Дерм»",
    variants: [
      { sku: "33370", volume: "1 шт.", price: 671, inStock: true }
    ]
  },
  {
    id: "accessories-kist-pryamaya",
    category: "accessories",
    name: "Кисть прямая",
    variants: [
      { sku: "87020", volume: "1 шт.", price: 549, inStock: true }
    ]
  },
  {
    id: "accessories-bandazh-20-4",
    category: "accessories",
    name: "Бандаж 20×4",
    variants: [
      { sku: "0761", volume: "1 шт.", price: 793, inStock: true }
    ]
  },
  {
    id: "accessories-bandazh-20-3",
    category: "accessories",
    name: "Бандаж 20×3",
    variants: [
      { sku: "0798", volume: "1 шт.", price: 610, inStock: true }
    ]
  },
  {
    id: "accessories-plenka-p-et-200-metrov-30-sm-8-mk",
    category: "accessories",
    name: "Пленка п/эт 200 метров / 30 см / 8 мк",
    variants: [
      { sku: "20038", volume: "1 шт.", price: 244, inStock: true }
    ]
  },
  {
    id: "accessories-prostyni-polietilenovye-200-230",
    category: "accessories",
    name: "Простыни полиэтиленовые 200×230",
    variants: [
      { sku: "40012", volume: "упаковка 25 шт.", price: 915, inStock: true }
    ]
  },
  {
    id: "accessories-nozh-dlya-plenki",
    category: "accessories",
    name: "Нож для пленки",
    variants: [
      { sku: "87004", volume: "1 шт.", price: 244, inStock: true }
    ]
  },
  {
    id: "accessories-metodicheskie-ukazaniya-aromaderm-telo",
    category: "accessories",
    name: "Методические указания Aromaderm (тело)",
    variants: [
      { sku: "99916", volume: "1 шт.", price: 490, inStock: true }
    ]
  },
  {
    id: "accessories-pompa-dozator-dlya-masel-1000-ml",
    category: "accessories",
    name: "Помпа-дозатор для масел 1000 мл",
    variants: [
      { sku: "145", volume: "1 шт.", price: 366, inStock: true }
    ]
  },
  {
    id: "accessories-pompa-dozator-dlya-kremov-0-5-l",
    category: "accessories",
    name: "Помпа-дозатор для кремов 0,5 л",
    variants: [
      { sku: "146", volume: "1 шт.", price: 732, inStock: true }
    ]
  },
  {
    id: "accessories-kostyum-lpg-belyy-besshovnyy-l-xl-xxl",
    category: "accessories",
    name: "Костюм LPG белый бесшовный L/XL/XXL",
    variants: [
      { sku: "4***", volume: "1 шт.", price: 690, inStock: true }
    ]
  }
];

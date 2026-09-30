import type { Lang } from './templates/types';

const dict = {
  appTitle: { uk: 'Emoji Studio', ru: 'Emoji Studio', en: 'Emoji Studio' },
  appSubtitle: { uk: 'Редактор Lottie-емодзі', ru: 'Редактор Lottie-эмодзи', en: 'Lottie emoji editor' },
  summaryText: { uk: 'Текст', ru: 'Текст', en: 'Text' },
  summaryLogo: { uk: 'Лого', ru: 'Лого', en: 'Logo' },
  summaryColors: { uk: 'Кольори', ru: 'Цвета', en: 'Colors' },
  summarySelected: { uk: 'Обрано', ru: 'Выбрано', en: 'Selected' },
  preview: { uk: 'Перегляд', ru: 'Просмотр', en: 'Preview' },
  bgLight: { uk: 'Світлий фон', ru: 'Светлый фон', en: 'Light background' },
  bgDark: { uk: 'Темний фон', ru: 'Тёмный фон', en: 'Dark background' },
  bgChess: { uk: 'Прозорий фон', ru: 'Прозрачный фон', en: 'Transparent background' },
  play: { uk: 'Відтворити', ru: 'Воспроизвести', en: 'Play' },
  pause: { uk: 'Пауза', ru: 'Пауза', en: 'Pause' },
  inChat: { uk: 'У чаті', ru: 'В чате', en: 'In chat' },
  tabText: { uk: 'Текст', ru: 'Текст', en: 'Text' },
  tabLogo: { uk: 'Лого SVG', ru: 'Лого SVG', en: 'SVG logo' },
  textPlaceholder: { uk: 'Ваш текст', ru: 'Ваш текст', en: 'Your text' },
  textHint: { uk: 'Enter — новий рядок', ru: 'Enter — новая строка', en: 'Enter — new line' },
  missingChars: { uk: 'Шрифт не містить символів:', ru: 'Шрифт не содержит символов:', en: 'The font has no glyphs for:' },
  fontDefault: { uk: 'Шрифт', ru: 'Шрифт', en: 'Font' },
  fontUpload: { uk: 'Завантажити свій шрифт (TTF, OTF, WOFF)', ru: 'Загрузить свой шрифт (TTF, OTF, WOFF)', en: 'Upload your font (TTF, OTF, WOFF)' },
  fontError: { uk: 'Не вдалося прочитати шрифт. Підтримуються TTF, OTF і WOFF.', ru: 'Не удалось прочитать шрифт. Поддерживаются TTF, OTF и WOFF.', en: 'Could not read the font. TTF, OTF and WOFF are supported.' },
  fontLoading: { uk: 'Завантаження шрифту…', ru: 'Загрузка шрифта…', en: 'Loading font…' },
  fill: { uk: 'Заливка', ru: 'Заливка', en: 'Fill' },
  outline: { uk: 'Обводка', ru: 'Обводка', en: 'Outline' },
  accent: { uk: 'Акцент', ru: 'Акцент', en: 'Accent' },
  randomColors: { uk: 'Випадкові кольори', ru: 'Случайные цвета', en: 'Random colors' },
  styleSettings: { uk: 'Налаштування стилю', ru: 'Настройки стиля', en: 'Style settings' },
  outlineWidth: { uk: 'Товщина обводки', ru: 'Толщина обводки', en: 'Outline width' },
  letterSpacing: { uk: 'Міжлітерний інтервал', ru: 'Межбуквенный интервал', en: 'Letter spacing' },
  lineHeight: { uk: 'Міжрядковий інтервал', ru: 'Межстрочный интервал', en: 'Line height' },
  uppercase: { uk: 'ВЕЛИКІ ЛІТЕРИ', ru: 'ЗАГЛАВНЫЕ БУКВЫ', en: 'UPPERCASE' },
  logoDrop: { uk: 'Перетягніть SVG сюди або натисніть, щоб обрати файл', ru: 'Перетащите SVG сюда или нажмите, чтобы выбрать файл', en: 'Drop an SVG here or tap to choose a file' },
  logoHint: {
    uk: 'Векторні логотипи й іконки: контури, фігури, градієнти. Текст у SVG переведіть у криві.',
    ru: 'Векторные логотипы и иконки: контуры, фигуры, градиенты. Текст в SVG переведите в кривые.',
    en: 'Vector logos and icons: paths, shapes, gradients. Convert SVG text to outlines first.',
  },
  logoReplace: { uk: 'Замінити', ru: 'Заменить', en: 'Replace' },
  logoRemove: { uk: 'Видалити', ru: 'Удалить', en: 'Remove' },
  logoColors: { uk: 'Кольори лого', ru: 'Цвета лого', en: 'Logo colors' },
  logoOriginal: { uk: 'Оригінальні', ru: 'Оригинальные', en: 'Original' },
  logoRecolor: { uk: 'Перефарбувати', ru: 'Перекрасить', en: 'Recolor' },
  logoOutline: { uk: 'Обводка навколо лого', ru: 'Обводка вокруг лого', en: 'Outline around logo' },
  logoStats: { uk: 'елементів', ru: 'элементов', en: 'elements' },
  errParse: { uk: 'Файл не схожий на SVG.', ru: 'Файл не похож на SVG.', en: 'This file does not look like an SVG.' },
  errEmpty: { uk: 'У SVG не знайдено векторних фігур.', ru: 'В SVG не найдено векторных фигур.', en: 'No vector shapes found in the SVG.' },
  errTooLarge: { uk: 'Файл завеликий (макс. 3 МБ).', ru: 'Файл слишком большой (макс. 3 МБ).', en: 'File is too large (max 3 MB).' },
  warnText: { uk: 'Текст у SVG пропущено — переведіть його в криві.', ru: 'Текст в SVG пропущен — переведите его в кривые.', en: 'SVG text was skipped — convert it to outlines.' },
  warnImage: { uk: 'Растрові зображення в SVG не підтримуються.', ru: 'Растровые изображения в SVG не поддерживаются.', en: 'Raster images inside SVG are not supported.' },
  warnClip: { uk: 'Маски й обрізки (clip-path) проігноровано.', ru: 'Маски и обрезки (clip-path) проигнорированы.', en: 'Clip paths were ignored.' },
  warnMask: { uk: 'Маски проігноровано.', ru: 'Маски проигнорированы.', en: 'Masks were ignored.' },
  warnFilter: { uk: 'Фільтри (тіні, розмиття) проігноровано.', ru: 'Фильтры (тени, размытие) проигнорированы.', en: 'Filters (shadows, blur) were ignored.' },
  warnPattern: { uk: 'Візерунки (pattern) не підтримуються.', ru: 'Узоры (pattern) не поддерживаются.', en: 'Patterns are not supported.' },
  warnComplex: { uk: 'Дуже складне лого — файл може перевищити 64 КБ.', ru: 'Очень сложное лого — файл может превысить 64 КБ.', en: 'Very complex logo — the file may exceed 64 KB.' },
  presets: { uk: 'Готові розфарбовки', ru: 'Готовые расцветки', en: 'Color presets' },
  emojiColors: { uk: 'Кольори', ru: 'Цвета', en: 'Emoji' },
  emojiColorsSub: { uk: 'емодзі', ru: 'эмодзи', en: 'colors' },
  makeGradient: { uk: 'Створити градієнт', ru: 'Создать градиент', en: 'Make gradient' },
  removeGradient: { uk: 'Прибрати градієнт', ru: 'Убрать градиент', en: 'Remove gradient' },
  rotateGradient: { uk: 'Повернути градієнт', ru: 'Повернуть градиент', en: 'Rotate gradient' },
  radialGradient: { uk: 'Радіальний', ru: 'Радиальный', en: 'Radial' },
  swapColors: { uk: 'Поміняти місцями', ru: 'Поменять местами', en: 'Swap colors' },
  size: { uk: 'Розмір', ru: 'Размер', en: 'Size' },
  height: { uk: 'Висота', ru: 'Высота', en: 'Height' },
  emojiOutline: { uk: 'Обводка персонажа', ru: 'Обводка персонажа', en: 'Character outline' },
  characters: { uk: 'Персонажі', ru: 'Персонажи', en: 'Characters' },
  charactersHint: { uk: 'Торкніться, щоб обрати кілька', ru: 'Нажмите, чтобы выбрать несколько', en: 'Tap to select several' },
  importLottie: { uk: 'Свій Lottie / TGS', ru: 'Свой Lottie / TGS', en: 'Your Lottie / TGS' },
  importError: { uk: 'Не вдалося відкрити файл Lottie/TGS.', ru: 'Не удалось открыть файл Lottie/TGS.', en: 'Could not open the Lottie/TGS file.' },
  importedPalette: { uk: 'Кольори анімації', ru: 'Цвета анимации', en: 'Animation colors' },
  importedOverlay: { uk: 'Додати текст / лого поверх', ru: 'Добавить текст / лого поверх', en: 'Add text / logo on top' },
  importedRemove: { uk: 'Прибрати анімацію', ru: 'Убрать анимацию', en: 'Remove animation' },
  importedReset: { uk: 'Скинути кольори', ru: 'Сбросить цвета', en: 'Reset colors' },
  kb: { uk: 'КБ', ru: 'КБ', en: 'KB' },
  download: { uk: 'Завантажити', ru: 'Скачать', en: 'Download' },
  exportTitle: { uk: 'Експорт емодзі', ru: 'Экспорт эмодзи', en: 'Export emoji' },
  exportTgs: { uk: 'TGS (Telegram)', ru: 'TGS (Telegram)', en: 'TGS (Telegram)' },
  exportJson: { uk: 'Lottie JSON', ru: 'Lottie JSON', en: 'Lottie JSON' },
  exportZip: { uk: 'Усі одним ZIP', ru: 'Все одним ZIP', en: 'All as ZIP' },
  exportEmpty: { uk: 'Оберіть хоча б одного персонажа.', ru: 'Выберите хотя бы одного персонажа.', en: 'Select at least one character.' },
  exportOk: { uk: 'Готово для Telegram', ru: 'Готово для Telegram', en: 'Ready for Telegram' },
  problemSize: { uk: 'Більше 64 КБ — спростіть лого або зменшіть кількість деталей', ru: 'Больше 64 КБ — упростите лого или уменьшите детализацию', en: 'Over 64 KB — simplify the logo' },
  problemCanvas: { uk: 'Полотно має бути 512×512', ru: 'Холст должен быть 512×512', en: 'Canvas must be 512×512' },
  problemFps: { uk: 'Потрібно 60 FPS', ru: 'Нужно 60 FPS', en: 'Must be 60 FPS' },
  problemDuration: { uk: 'Довше 3 секунд', ru: 'Дольше 3 секунд', en: 'Longer than 3 seconds' },
  howToTitle: { uk: 'Як додати в Telegram', ru: 'Как добавить в Telegram', en: 'How to add to Telegram' },
  howTo1: { uk: 'Відкрийте бота @Stickers і надішліть /newemojipack.', ru: 'Откройте бота @Stickers и отправьте /newemojipack.', en: 'Open @Stickers bot and send /newemojipack.' },
  howTo2: { uk: 'Оберіть «Анімовані емодзі» та надішліть файли .tgs.', ru: 'Выберите «Анимированные эмодзи» и отправьте файлы .tgs.', en: 'Choose “Animated emoji” and send the .tgs files.' },
  howTo3: { uk: 'Для кожного вкажіть емодзі-відповідник, потім /publish.', ru: 'Для каждого укажите эмодзи-соответствие, затем /publish.', en: 'Assign an emoji to each one, then /publish.' },
  close: { uk: 'Закрити', ru: 'Закрыть', en: 'Close' },
  telegramDownloadNote: {
    uk: 'У деяких клієнтах Telegram завантаження файлів з міні-застосунку заблоковане — відкрийте редактор у браузері.',
    ru: 'В некоторых клиентах Telegram скачивание файлов из мини-приложения заблокировано — откройте редактор в браузере.',
    en: 'Some Telegram clients block downloads inside mini apps — open the editor in a browser.',
  },
  sendToChat: { uk: 'Надіслати в чат', ru: 'Отправить в чат', en: 'Send to chat' },
  sending: { uk: 'Надсилаю…', ru: 'Отправляю…', en: 'Sending…' },
  sendHint: {
    uk: 'Бот надішле файли .tgs вам у чат — звідти їх легко переслати в @Stickers.',
    ru: 'Бот пришлёт файлы .tgs вам в чат — оттуда их легко переслать в @Stickers.',
    en: 'The bot will send the .tgs files to your chat — easy to forward to @Stickers.',
  },
  sentToChat: { uk: 'Готово! Файли вже в чаті з ботом.', ru: 'Готово! Файлы уже в чате с ботом.', en: 'Done! The files are in your chat with the bot.' },
  goToChat: { uk: 'До чату', ru: 'В чат', en: 'Open chat' },
  sendFailed: { uk: 'Не вдалося надіслати. Спробуйте ще раз.', ru: 'Не удалось отправить. Попробуйте ещё раз.', en: 'Could not send. Please try again.' },
  sendDenied: {
    uk: 'Бот не може вам написати. Натисніть «Start» у чаті з ботом або дозвольте повідомлення.',
    ru: 'Бот не может вам написать. Нажмите «Start» в чате с ботом или разрешите сообщения.',
    en: 'The bot cannot message you. Press “Start” in the bot chat or allow messages.',
  },
  sendUnauthorized: {
    uk: 'Сесія застаріла — закрийте й знову відкрийте редактор з бота.',
    ru: 'Сессия устарела — закройте и снова откройте редактор из бота.',
    en: 'The session expired — close and reopen the editor from the bot.',
  },
  downloadInstead: { uk: 'Завантажити файлом', ru: 'Скачать файлом', en: 'Download as file' },
  openInBrowser: { uk: 'Відкрити в браузері', ru: 'Открыть в браузере', en: 'Open in browser' },
  hex: { uk: 'HEX', ru: 'HEX', en: 'HEX' },
  customColor: { uk: 'Інший колір', ru: 'Другой цвет', en: 'Custom color' },
  reset: { uk: 'Скинути все', ru: 'Сбросить всё', en: 'Reset all' },
  resetConfirm: { uk: 'Скинути всі налаштування?', ru: 'Сбросить все настройки?', en: 'Reset all settings?' },
} satisfies Record<string, Record<Lang, string>>;

export type I18nKey = keyof typeof dict;

export function translate(lang: Lang, key: I18nKey): string {
  return dict[key][lang];
}

export function detectLang(): Lang {
  const candidates: string[] = [];
  const tgLang = (window as unknown as { Telegram?: { WebApp?: { initDataUnsafe?: { user?: { language_code?: string } } } } }).Telegram?.WebApp
    ?.initDataUnsafe?.user?.language_code;
  if (tgLang) candidates.push(tgLang);
  if (typeof navigator !== 'undefined') candidates.push(...(navigator.languages ?? [navigator.language]));
  for (const c of candidates) {
    const code = c.toLowerCase().slice(0, 2);
    if (code === 'uk' || code === 'ru' || code === 'en') return code;
  }
  return 'uk';
}

import type { AvatarDefinition } from 'open-bot-avatar'

/**
 * Bot 头像的形状库。
 *
 * 数据来源：open-bot-avatar v0.4.0（MIT）—— 7 个包内 starter + 16 个官方 gallery。
 * 每个定义只是「一条 0 0 100 100 的轮廓路径 + 两只眼的位置」，颜色/体积/朝向/眨眼
 * 全由运行时负责，所以这里不需要任何渲染逻辑。
 *
 * 为什么抄进来而不是从包里 import getExample：
 * 包只导出 7 个 starter，gallery 那 16 个是仓库里的 JSON，不随包发布。抄成 TS 常量
 * 才能让一个 Bot 一个形状，也才不会被上游的小版本变更影响外观。
 */

const SHAPES: AvatarDefinition[] = [
  {
    version: 1,
    id: "controller",
    name: "Controller",
    body: { path: "M28 22C38 20 44 23 50 23C56 23 62 20 72 22C84 24 90 34 91 48C92 62 91 76 82 80C75 83 69 78 66 72C63 67 58 66 50 66C42 66 37 67 34 72C31 78 25 83 18 80C9 76 8 62 9 48C10 34 16 24 28 22Z" },
    eyes: { x: 50, y: 42, spacing: 16, scale: 1.05 },
  },
  {
    version: 1,
    id: "barbell",
    name: "Barbell",
    body: { path: "M12 41H12A4 4 0 0 1 16 45V55A4 4 0 0 1 12 59H12A4 4 0 0 1 8 55V45A4 4 0 0 1 12 41ZM18 29H18A4 4 0 0 1 22 33V67A4 4 0 0 1 18 71H18A4 4 0 0 1 14 67V33A4 4 0 0 1 18 29ZM26 17H26A5 5 0 0 1 31 22V78A5 5 0 0 1 26 83H26A5 5 0 0 1 21 78V22A5 5 0 0 1 26 17ZM38 33H62A10 10 0 0 1 72 43V57A10 10 0 0 1 62 67H38A10 10 0 0 1 28 57V43A10 10 0 0 1 38 33ZM74 17H74A5 5 0 0 1 79 22V78A5 5 0 0 1 74 83H74A5 5 0 0 1 69 78V22A5 5 0 0 1 74 17ZM82 29H82A4 4 0 0 1 86 33V67A4 4 0 0 1 82 71H82A4 4 0 0 1 78 67V33A4 4 0 0 1 82 29ZM88 41H88A4 4 0 0 1 92 45V55A4 4 0 0 1 88 59H88A4 4 0 0 1 84 55V45A4 4 0 0 1 88 41Z" },
    eyes: { x: 50, y: 50, spacing: 15, scale: 1.05 },
  },
  {
    version: 1,
    id: "mug",
    name: "Mug",
    body: { path: "M22 20H62C67 20 70 23 70 28V72C70 80 64 86 56 86H28C20 86 14 80 14 72V28C14 23 17 20 22 20ZM68 36C80 34 87 42 87 53C87 64 80 72 68 70ZM69 45L69 61C75.5 62 79 58.5 79 53C79 47.5 76 44 69 45Z" },
    eyes: { x: 42, y: 49, spacing: 16, scale: 1.15 },
  },
  {
    version: 1,
    id: "lightbulb",
    name: "Lightbulb",
    body: { path: "M36 72V66C36 60 18 55 18 40A32 32 0 0 1 82 40C82 55 64 60 64 66V72ZM36 68H64V77A4 4 0 0 1 60 81H40A4 4 0 0 1 36 77ZM43 78H57V84A4 4 0 0 1 53 88H47A4 4 0 0 1 43 84Z" },
    eyes: { x: 50, y: 40, spacing: 17, scale: 1.2 },
  },
  {
    version: 1,
    id: "chat",
    name: "Chat",
    body: { path: "M28 14H72C82 14 90 22 90 32V54C90 64 82 72 72 72H42L25 86C23.5 87.3 21.5 86 22.3 84L27 71.5C17 70 10 63 10 54V32C10 22 18 14 28 14Z" },
    eyes: { x: 50, y: 42, spacing: 18, scale: 1.25 },
  },
  {
    version: 1,
    id: "sprout",
    name: "Sprout",
    body: { path: "M49.5 19H50.5A3 3 0 0 1 53.5 22V46H46.5V22A3 3 0 0 1 49.5 19ZM49 38C36 41 22.5 36 17.6 23.4A1.4 1.4 0 0 1 18.4 21.6C29 17.5 41.5 21.5 49 34ZM51 30C57 14.5 72 8.5 82.6 11.8A1.4 1.4 0 0 1 83.5 13.4C80.5 27.5 66 35.5 51 34ZM24 44H76A4 4 0 0 1 80 48V54A4 4 0 0 1 76 58H24A4 4 0 0 1 20 54V48A4 4 0 0 1 24 44ZM24 56H76L71 84C70.4 87.5 68 90 64.5 90H35.5C32 90 29.6 87.5 29 84Z" },
    eyes: { x: 50, y: 71, spacing: 16, scale: 1.05 },
  },
  {
    version: 1,
    id: "watering-can",
    name: "Watering Can",
    body: { path: "M32 38H62C68 38 71 41 72 47L74 76C74.5 82 70 86 64 86H30C24 86 19.5 82 20 76L22 47C23 41 26 38 32 38ZM23 63C14 63 8.5 57 8.5 48C8.5 37 13 30.5 19 30.5C25 30.5 28.5 34 30 39.5L26 52ZM23.5 42C22 38 20 36 17.5 36C15 36 14 41 14 48C14 54 16 57.5 22 58L23.5 47ZM69 66C75 61 78 55 80 46.5L88 49.5C85 62 80 73 72 81ZM78.7 43A7 4.5 25 0 1 91.3 49A7 4.5 25 0 1 78.7 43Z" },
    eyes: { x: 47, y: 61, spacing: 16, scale: 1.15 },
  },
  {
    version: 1,
    id: "book",
    name: "Book",
    body: { path: "M12 32C12 29 14 27 17 26C30 21.5 42 23 50 31C58 23 70 21.5 83 26C86 27 88 29 88 32L88 64L89 64C90.7 64 92 65.3 92 67L92 75C92 77 90.5 78 88.5 77.5C76 75 60 76 50 84C40 76 24 75 11.5 77.5C9.5 78 8 77 8 75L8 67C8 65.3 9.3 64 11 64L12 64Z" },
    eyes: { x: 50, y: 51, spacing: 18, scale: 1.1 },
  },
  {
    version: 1,
    id: "brain",
    name: "Brain",
    body: { path: "M14 50C10 42 14 32 22 30C24 21 34 17 41 21C46 15 56 15 61 20C68 16 78 20 79 28C87 30 91 39 88 47C92 54 89 64 81 66C80 71 76 74 71 73C67 75 64 74 62 72C61 74 61 76 61.5 78C62 81 59 82.5 57 81.5C55.5 80.5 55 78 54 76C53 74 50 72.5 47 72.5C42 74 38 72 36 70C30 73 20 71 18 64C12 62 10 56 14 50Z" },
    eyes: { x: 50, y: 45, spacing: 17, scale: 1.15 },
  },
  {
    version: 1,
    id: "bull",
    name: "Bull",
    body: { path: "M40 28L60 28C70 28 76 36 76 48L76 62C76 74 66 84 50 84C34 84 24 74 24 62L24 48C24 36 30 28 40 28ZM32 40C22 38 15 32 15 24C15 18 18 13 22 10C25 8 28 10 27 13C25 18 24 22 28 26C31 29 36 30 42 30ZM58 30C64 30 69 29 72 26C76 22 75 18 73 13C72 10 75 8 78 10C82 13 85 18 85 24C85 32 78 38 68 40ZM29 55C23 56 17 55 12 52C9 50 8 47 10 45C14 41 22 40 28 42ZM72 42C78 40 86 41 90 45C92 47 91 50 88 52C83 55 77 56 71 55Z" },
    eyes: { x: 50, y: 52, spacing: 17, scale: 1.15 },
  },
  {
    version: 1,
    id: "bunny",
    name: "Bunny",
    body: { path: "M50 40C68 40 80 50 80 64C80 78 68 86 50 86C32 86 20 78 20 64C20 50 32 40 50 40ZM30 46C26 36 24 24 26 16C28 10 34 10 37 15C40 22 42 34 42 44ZM58 44C58 34 61 22 66 15C69 10 76 11 76 17C76 25 74 36 70 46Z" },
    eyes: { x: 50, y: 62, spacing: 17, scale: 1.15 },
  },
  {
    version: 1,
    id: "camera",
    name: "Camera",
    body: { path: "M17 34L20 34L20 31C20 29 21 28 23 28L27 28C29 28 30 29 30 31L30 34L36 34L40 23C41 21 42 20 44 20L56 20C58 20 59 21 60 23L64 34L83 34C87.5 34 91 37.5 91 42L91 72C91 76.5 87.5 80 83 80L17 80C12.5 80 9 76.5 9 72L9 42C9 37.5 12.5 34 17 34Z" },
    eyes: { x: 50, y: 54, spacing: 17, scale: 1.1 },
  },
  {
    version: 1,
    id: "cat",
    name: "Cat",
    body: { path: "M50 23C68 23 82 30 82 45C82 58 68 65 50 65C32 65 18 58 18 45C18 30 32 23 50 23ZM24 42C21 32 20 22 22 15C23 11 26 10 29 12C34 16 39 21 44 28L36 42ZM64 42L56 28C61 21 66 16 71 12C74 10 77 11 78 15C80 22 79 32 76 42ZM38 56L62 56C70 56 74 66 74 76C74 83 70 86 63 86L37 86C30 86 26 83 26 76C26 66 30 56 38 56ZM70 72C77 74 81 70 80 64C79 60 81 57 84 58C87 59 88.5 63 88 68C87 77 80 83 70 81Z" },
    eyes: { x: 50, y: 43, spacing: 17, scale: 1.1 },
  },
  {
    version: 1,
    id: "cloud",
    name: "Cloud",
    body: { path: "M24 76C14 76 9 69 9 61C9 52 15 46 23 45.5C25 33 36 24 49 24C61 24 70 31 73 41C83 41 91 49 91 59C91 69 83 76 74 76Z" },
    eyes: { x: 50, y: 54, spacing: 17, scale: 1.15 },
  },
  {
    version: 1,
    id: "egg",
    name: "Egg",
    body: { path: "M50 10C66 10 82 34 82 58C82 76 68 88 50 88C32 88 18 76 18 58C18 34 34 10 50 10Z" },
    eyes: { x: 50, y: 54, spacing: 17, scale: 1.2 },
  },
  {
    version: 1,
    id: "ghost",
    name: "Ghost",
    body: { path: "M24 50C24 28 35 12 50 12C65 12 76 28 76 50L77 80C77 85 73 88 68 88C63 88 61 84 59 81C57 84 54 88 50 88C46 88 43 84 41 81C39 84 37 88 32 88C27 88 23 85 23 80Z" },
    eyes: { x: 50, y: 42, spacing: 16, scale: 1.15 },
  },
  {
    version: 1,
    id: "magnifier",
    name: "Magnifier",
    body: { path: "M41 12A29 29 0 0 1 64.44 58.08L68.5 62.13A8 8 0 0 1 75.65 64.33L87.67 76.36A8 8 0 0 1 76.36 87.67L64.33 75.65A8 8 0 0 1 62.13 68.5L58.08 64.44A29 29 0 1 1 41 12Z" },
    eyes: { x: 41, y: 40, spacing: 17, scale: 1.15 },
  },
  {
    version: 1,
    id: "paint-brush",
    name: "Paint Brush",
    body: { path: "M77.2 8.5C80.3 8.7 82.3 10.2 83.4 13.1C84 14.5 83.3 16.2 82.3 17.6L65.9 40.8L56.2 33.7L73.2 11C74.2 9.6 75.6 8.5 77.2 8.5ZM55.4 26.8L72.8 39.4C74.2 40.4 74.5 42.2 73.5 43.6L66.6 53C65.6 54.4 63.8 54.7 62.4 53.7L45.1 41C43.7 40 43.4 38.2 44.4 36.8L51.2 27.4C52.2 26 54 25.8 55.4 26.8ZM48.4 38.7L63.7 49.8C67.9 57.1 66.8 65.9 61.8 72.9C54.7 82.6 41.2 86.6 25.2 85.1C22.2 85 20 82.9 21 79.9C24.6 71.4 21.1 57.1 28.2 47.4C33.3 40.4 40.8 37.4 48.4 38.7Z" },
    eyes: { x: 44, y: 59, spacing: 16, scale: 1.05 },
  },
  {
    version: 1,
    id: "palette",
    name: "Palette",
    body: { path: "M46 18C70 16 90 28 90 48C90 68 74 84 52 84C42 84 36 80 34 74C32 68 36 64 32 60C28 56 22 62 16 58C10 54 10 46 12 40C16 26 30 19 46 18ZM20 42A6.5 8 0 1 0 33 42A6.5 8 0 1 0 20 42Z" },
    eyes: { x: 58, y: 46, spacing: 17, scale: 1.15 },
  },
  {
    version: 1,
    id: "rocket",
    name: "Rocket",
    body: { path: "M46 10C48 8.5 52 8.5 54 10C64 17 71 29 71 44L71 69C71 74 68 77 63 77L37 77C32 77 29 74 29 69L29 44C29 29 36 17 46 10ZM65 50L70.5 52C79 57 87 68 87 81C87 85.5 84 88 80.5 86.5L65 76ZM35 76L19.5 86.5C16 88 13 85.5 13 81C13 68 21 57 29.5 52L35 50ZM41 74L59 74C60 82 56 88 50 91C44 88 40 82 41 74Z" },
    eyes: { x: 50, y: 46, spacing: 15, scale: 1.05 },
  },
  {
    version: 1,
    id: "shield",
    name: "Shield",
    body: { path: "M50 14C60 18 72 18 82 16Q86 16 86 20L86 46C86 64 72 78 54 86.5Q50 88.5 46 86.5C28 78 14 64 14 46L14 20Q14 16 18 16C28 18 40 18 50 14Z" },
    eyes: { x: 50, y: 42, spacing: 17, scale: 1.15 },
  },
  {
    version: 1,
    id: "star",
    name: "Star",
    body: { path: "M53.7 17.95L62 31.2Q64.1 34.6 68 35.6L83.1 39.3Q89.9 41 85.4 46.4L75.4 58.3Q72.8 61.4 73.1 65.4L74.2 81Q74.7 88 68.2 85.4L53.7 79.5Q50 78 46.3 79.5L31.8 85.4Q25.3 88 25.8 81L26.9 65.4Q27.2 61.4 24.6 58.3L14.6 46.4Q10.1 41 16.9 39.3L32 35.6Q35.9 34.6 38 31.2L46.3 17.95Q50 12 53.7 17.95Z" },
    eyes: { x: 50, y: 52, spacing: 16, scale: 1.1 },
  },
  {
    version: 1,
    id: "witch-hat",
    name: "Witch Hat",
    body: { path: "M50 72C72 72 92 75 92 80C92 85 72 87 50 87C28 87 8 85 8 80C8 75 28 72 50 72ZM50 14.73C60.78 18.98 67.14 27.15 69.44 38L77.5 76Q78 80 74 80L26 80Q22 80 22.5 76L30.56 38C32.86 27.15 39.22 18.98 50 14.73ZM41.58 19.5C44.5 17.2 47.97 15.34 52 14C62 10.5 72 9 81 11A3.2 3.2 0 0 1 81 17.4C75.5 18.2 67.96 31 69.44 38L64 30L56 22L48 20Z" },
    eyes: { x: 50, y: 54, spacing: 15, scale: 1.05 },
  },
]

/**
 * 每个形状的出厂配色，取 gallery/colors.json 的原值。
 *
 * 注意：这**不是**头像的默认颜色。默认颜色仍然由 Bot 自己的 avatarColor 决定
 * （用户挑的），这里只在用户没挑、且我们希望形状自带一点性格时才用得上。
 */
export const SHAPE_COLORS: Record<string, string> = {
  "controller": "#ff6a1a",
  "barbell": "#f2384b",
  "mug": "#f4f4f4",
  "lightbulb": "#f8a01c",
  "chat": "#8b5cf6",
  "sprout": "#1fbf68",
  "watering-can": "#14b3a5",
  "book": "#a8693f",
  "brain": "#ec4899",
  "bull": "#f2384b",
  "bunny": "#ec4899",
  "camera": "#7a7a7a",
  "cat": "#f8a01c",
  "cloud": "#14b3a5",
  "egg": "#f4f4f4",
  "ghost": "#f4f4f4",
  "magnifier": "#1f7cf2",
  "paint-brush": "#1fbf68",
  "palette": "#a8693f",
  "rocket": "#7a7a7a",
  "shield": "#1f7cf2",
  "star": "#ff6a1a",
  "witch-hat": "#8b5cf6",
}

/** 形状 id 的稳定顺序：散列取模要用它，别用 Object.keys（顺序不保证跨运行一致）。 */
export const SHAPE_IDS: string[] = [
  "controller",
  "barbell",
  "mug",
  "lightbulb",
  "chat",
  "sprout",
  "watering-can",
  "book",
  "brain",
  "bull",
  "bunny",
  "camera",
  "cat",
  "cloud",
  "egg",
  "ghost",
  "magnifier",
  "paint-brush",
  "palette",
  "rocket",
  "shield",
  "star",
  "witch-hat",
]

/** id → 定义，O(1) 查找。 */
export const SHAPES_BY_ID: Record<string, AvatarDefinition> = Object.fromEntries(
  SHAPES.map((s) => [s.id, s]),
)

/** 全部形状（按稳定顺序），给选择器用。 */
export const ALL_SHAPES: AvatarDefinition[] = SHAPES

/**
 * 按 Bot id 散列取一个稳定形状：同 id 每次都是同一个，不同 id 尽量分散。
 *
 * 用散列而不是随机数 —— 随机数会让「新建一个 Bot」每次都换脸，用户会觉得
 * 这个 Bot 不是同一个。
 *
 * 这里**故意**和 lib/bot-avatar.ts 取色用的不是同一个散列：
 * 取色是 `h*31`，如果形状也用 h*31，那么「同色的两个 Bot 必然同形状」——
 * 这就把两个独立的外观维度绑成了一个。所以先用 FNV-1a 的素数 16777619
 * 并加一个盐，让形状与颜色在同一批 id 上不相关。
 */
const SHAPE_SALT = 0x9e3779b9

export function shapeForBot(id: string): AvatarDefinition {
  let h = SHAPE_SALT
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return SHAPES_BY_ID[SHAPE_IDS[h % SHAPE_IDS.length]!] ?? SHAPES[0]!
}


/**
 * 小尺寸下把眼睛放大。
 *
 * 实测（canvas 像素统计，白身黑眼）：
 *
 *   14px · scale 1.15 → 每只眼 3.0px，缩到 2~3 个像素就是一团灰
 *   14px · scale 1.80 → 每只眼 4~5px，能看出"这是个脸"
 *   18px · scale 1.80 → 每只眼 4.5~9.5px，稳
 *
 * 契约允许 scale 0.6..1.8、spacing 随 scale 有下限（scale 1.8 时 ≥12.6），
 * 所以放大眼睛的同时把间距一起抬到安全区，别让两只眼糊成一只。
 *
 * 只在 <20px 时动：34px 以上原尺寸的眼睛已经很清楚，放大会显得呆。
 */
export function shapeForSize(shape: AvatarDefinition, size: number): AvatarDefinition {
  if (size >= 20) return shape
  const scale = Math.max(shape.eyes.scale, 1.8)
  return {
    ...shape,
    eyes: {
      ...shape.eyes,
      scale,
      // 契约：spacing 下限 ≈ 7 * scale；这里取 10 * scale 留余量，且不小于原值
      spacing: Math.max(shape.eyes.spacing, Math.round(scale * 12)),
    },
  }
}

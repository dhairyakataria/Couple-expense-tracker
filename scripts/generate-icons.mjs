/**
 * Renders public/icons/icon.svg into the PNG sizes a TWA build needs.
 *
 * Bubblewrap requires a raster 512x512 icon; SVG alone is not enough, even
 * though modern Chrome accepts it in the manifest. Run this once after any
 * change to the source icon:
 *
 *   npm run icons
 */

import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const iconsDir = join(root, 'public', 'icons')
const source = readFileSync(join(iconsDir, 'icon.svg'))

const BRAND = '#3b6ef5'

mkdirSync(iconsDir, { recursive: true })

/** Plain icons: the artwork fills the canvas. */
async function plain(size) {
  await sharp(source, { density: 384 })
    .resize(size, size)
    .png()
    .toFile(join(iconsDir, `icon-${size}.png`))
  console.log(`  icon-${size}.png`)
}

/**
 * Maskable icon: Android crops this to whatever shape the launcher uses, so
 * the artwork sits at 60% inside a solid brand square. Anything outside the
 * inner 80% circle can be cut off.
 */
async function maskable(size) {
  const inner = Math.round(size * 0.6)
  const artwork = await sharp(source, { density: 384 }).resize(inner, inner).png().toBuffer()

  await sharp({
    create: { width: size, height: size, channels: 4, background: BRAND },
  })
    .composite([{ input: artwork, gravity: 'centre' }])
    .png()
    .toFile(join(iconsDir, `icon-maskable-${size}.png`))
  console.log(`  icon-maskable-${size}.png`)
}

console.log('Generating icons…')
await Promise.all([plain(192), plain(512), maskable(512)])
console.log('Done.')

// Export the canvas as a standalone SVG or PNG. The live SVG is styled by the page's CSS
// (theme variables, heat classes), which a downloaded file would not have, so the export clones
// it and copies each element's *computed* style inline. What you see, in the current theme and
// simulation state, is what you get.

/** Presentation properties worth baking in; everything else is left to SVG defaults. */
const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'color',
  'font-family',
  'font-size',
  'font-weight',
  'paint-order',
]

/** Interactive-only parts that do not belong in a picture. */
const STRIP = ['.particles', '.edge-hit', '.port', 'title']

const PADDING = 32

export function canvasToSvg(svg: SVGSVGElement): { markup: string; width: number; height: number } {
  const viewport = svg.querySelector<SVGGElement>('g.viewport')!
  // getBBox is in the viewport's own (world) coordinates, so it ignores pan and zoom.
  const box = viewport.getBBox()
  const width = Math.ceil(box.width + PADDING * 2)
  const height = Math.ceil(box.height + PADDING * 2)

  const clone = svg.cloneNode(true) as SVGSVGElement
  const originals = svg.querySelectorAll('*')
  const copies = clone.querySelectorAll('*')
  // Both lists are in document order, so index i is the same element in each.
  originals.forEach((original, i) => {
    const computed = getComputedStyle(original)
    copies[i].setAttribute('style', STYLE_PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(';'))
  })
  // Strip by class first, then drop the classes: the styles are inline now.
  for (const selector of STRIP) clone.querySelectorAll(selector).forEach((el) => el.remove())
  clone.querySelectorAll('[class]').forEach((el) => el.removeAttribute('class'))

  // Replace the dotted, camera-dependent background with a plain one in the page colour.
  clone.querySelector('pattern')?.remove()
  const background = clone.querySelector(':scope > rect')
  background?.setAttribute('fill', getComputedStyle(document.body).backgroundColor)
  background?.setAttribute('style', '')

  const cloneViewport = clone.querySelector<SVGGElement>(':scope > g')!
  cloneViewport.setAttribute('transform', `translate(${PADDING - box.x},${PADDING - box.y})`)

  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`)
  clone.removeAttribute('class')
  clone.removeAttribute('role')
  clone.setAttribute('style', `font-family:${getComputedStyle(svg).fontFamily}`)

  return { markup: new XMLSerializer().serializeToString(clone), width, height }
}

/** Rasterise SVG markup at `scale`× for crisp PNGs on high-density screens. */
export function svgToPng(markup: string, width: number, height: number, scale = 2): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width * scale
      canvas.height = height * scale
      const context = canvas.getContext('2d')!
      context.scale(scale, scale)
      context.drawImage(image, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create the PNG'))), 'image/png')
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not draw the SVG'))
    }
    image.src = url
  })
}

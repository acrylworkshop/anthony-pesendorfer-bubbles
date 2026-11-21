/**
 * A page background of hydrogen orbital probability clouds: turning the pointer clockwise morphs them up the ladder and counterclockwise
 * runs it back, looping from 4f to 1s.
 *
 * Every page the app answers gets one canvas behind its content and the module that draws the clouds. The canvas is aria-hidden and takes no
 * pointer events, so nothing about the page changes for a reader or a click. Switching the plugin off removes the canvas with the next reload.
 */
import { readFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'orbital-background'
export const inject = ['router']

/** The injection marker: a page that already carries it (the middleware runs once per response, but a nested response is not impossible) keeps one copy. */
const MARK = 'data-orbital-background'

/** The markup added before `</body>`: the canvas, its style, and the drawing module inlined so no URL has to know the mount prefix. */
function markup(): string {
  const script = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  // An inline script ends at the first closing script tag, so the client module must not contain one (it never needs to).
  if (script.includes('</script')) throw new Error('orbital-background: client.js must not contain a closing script tag')
  return (
    `<canvas ${MARK} aria-hidden="true"></canvas>` +
    `<style>canvas[${MARK}]{position:fixed;inset:0;width:100vw;height:100vh;z-index:-1;pointer-events:none}</style>` +
    `<script type="module">${script}</script>`
  )
}

/** The response as the wrapper sees it: enough of the framework's context to read the request and replace the response. */
interface PageContext {
  res: Response
  req: { method: string }
}

export function apply(ctx: Context): void {
  const html = markup()
  const addBackground = async (c: PageContext, next: () => Promise<void>): Promise<void> => {
    await next()
    if (c.req.method !== 'GET') return
    const response = c.res
    if (!((response.headers.get('content-type') ?? '').includes('text/html'))) return
    let page = await response.text()
    if (page.includes(MARK)) return
    page = page.includes('</body>') ? page.replace('</body>', `${html}</body>`) : page + html
    const headers = new Headers(response.headers)
    headers.delete('content-length')
    c.res = new Response(page, { status: response.status, statusText: response.statusText, headers })
  }
  // A wrapper around every request, whenever its mount was made: the app's pages are answered by another plugin's mount (`routes`), so a
  // middleware on a mount of this plugin's own would never see them.
  ctx.router.wrap(addBackground as never)
}

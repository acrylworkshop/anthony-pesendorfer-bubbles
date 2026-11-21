/**
 * Bubbles: a mind in the middle that breathes like a sound wave, bubbles that swim around it with friction, and lines that run their code in order.
 *
 * It is the app's page: it answers `/` and `/bubbles` with one HTML document, the drawing and gesture module riding inside it, so no URL has to
 * know where the app is mounted, and the first answer already carries the whole mind so the page paints without a round trip. Bubbles nest: entering one shows the bubbles
 * inside it, its own document and code. A line between two bubbles sets the run order, and a run walks a bubble, then the bubbles inside it,
 * recursively. Everything is kept in one JSON file in the app's home (`bubbles.json`).
 *
 * Code runs as a shell command in this app's folder, and only for a request from this machine. Every changing route insists on a JSON body,
 * which a page on another site cannot send without a cross-origin permission this app never grants.
 */
import { exec } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { Acryl, getConnInfo, type Context as HttpContext } from 'acrylblends'
import type {} from '@acryldev/instance'
import {
  StoreError,
  addBubble,
  addLink,
  executionPlan,
  patchBubble,
  readData,
  removeBubble,
  removeLink,
  restore,
  writeData,
  type BubblePatch,
  type BubblesData,
  type BubbleInput,
} from './store.ts'

export const name = 'bubbles'
export const inject = ['router', 'appInstance']

/** One command stops after this long, so a run cannot hold the request forever. */
const STEP_TIMEOUT_MS = 12_000
/** A whole run stops running code after this long; the steps it never reached are marked skipped. */
const RUN_BUDGET_MS = 60_000
const OUTPUT_LIMIT = 4_000
/** How many removals Undo can walk back, newest first. */
const UNDO_LIMIT = 25

/** The mind as it was just before a removal, and what that removal took, for Undo to put back. */
interface UndoPoint {
  data: BubblesData
  label: string
}

interface RunStep {
  bubbleId: string
  path: string[]
  depth: number
  status: 'ok' | 'failed' | 'skipped' | 'document' | 'empty' | 'container'
  code: string
  executable: boolean
  exitCode: number | null
  stdout: string
  stderr: string
  detail: string
}

const isLoopback = (address: string): boolean => {
  const plain = address.replace(/^\[|\]$/gu, '').replace(/^::ffff:/u, '')
  return plain === '::1' || plain === 'localhost' || plain.startsWith('127.')
}

const clip = (text: string): string => {
  const trimmed = text.replace(/\s+$/u, '')
  return trimmed.length <= OUTPUT_LIMIT ? trimmed : `${trimmed.slice(0, OUTPUT_LIMIT)}\n... (output cut)`
}

/** Runs one command with a shell, in the app's folder, and answers with what it printed. Never rejects: a failure is a result. */
function runCommand(
  command: string,
  cwd: string,
): Promise<{ status: 'ok' | 'failed'; exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: STEP_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const exitCode = error === null ? 0 : typeof error.code === 'number' ? error.code : null
        resolve({
          status: error === null ? 'ok' : 'failed',
          exitCode,
          stdout: clip(stdout),
          stderr: clip(stderr === undefined ? '' : String(stderr)),
        })
      },
    )
  })
}

/** A route's answer; a refused change becomes `{ error }` with the status the store chose. */
async function guard(c: HttpContext, work: () => Promise<Response>): Promise<Response> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof StoreError) return c.json({ error: error.message }, error.status)
    throw error
  }
}

/** The request's JSON object, or null when it is not a JSON request at all. */
async function jsonBody(c: HttpContext): Promise<Record<string, unknown> | null> {
  const type = (c.req.header('content-type') ?? '').toLowerCase()
  if (!type.includes('application/json')) return null
  const body: unknown = await c.req.json().catch(() => undefined)
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new StoreError(400, 'send a JSON object')
  }
  return body as Record<string, unknown>
}

function parentIdOf(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new StoreError(400, 'parentId must be a bubble id')
  return value
}

function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new StoreError(400, `${label} must be text`)
  return value
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new StoreError(400, `${label} must be a number`)
  }
  return value
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new StoreError(400, `${label} must be true or false`)
  return value
}

/** The whole page, with the drawing module inlined: it needs no URL, so no import map has to know the frame's prefix. */
function buildPage(client: string): (initial: unknown) => string {
  if (client.includes('</script')) throw new Error('bubbles: client.js must not contain a closing script tag')
  return (initial) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bubbles</title>
<style>
:root{color-scheme:dark;--galaxy-stops:#9fc4ff 0%,#7a9cf0 16%,#8f7cef 33%,#b383e6 50%,#d38de0 66%,#f2a6e0 82%,#f8e2f4 100%;--star:#eaf2ff;--haze:#9fc4ff;--pink:#f2a6e0;--panel:rgba(5,7,16,.82)}
*{box-sizing:border-box}
html,body{margin:0;height:100%}
body{background:#04050b;color:#e8eeff;font:14px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden}
/* The stage stays see-through so the app-wide orbital sky shows through; the body's black is only the base under it. */
#bubbles-app{display:grid;grid-template-rows:auto 1fr auto;height:100vh}
/* One bar, one row: the hint takes the width the title and the crumbs leave, and shortens rather than wrap. */
header{display:flex;flex-wrap:nowrap;gap:12px;align-items:center;padding:9px 16px;border-bottom:1px solid rgba(140,170,255,.16);background:var(--panel);position:relative;z-index:40}
header h1.galaxy-title{flex:0 0 auto;font-size:15px;letter-spacing:.1em;text-transform:uppercase;margin:0;font-weight:800;background-image:linear-gradient(100deg,var(--galaxy-stops));background-size:220% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
header .hint{margin:0;color:#9fadd0;font-size:12px;flex:1 1 auto;min-width:0;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header button{flex:0 0 auto}
button{font:inherit;color:#e9f0ff;background:rgba(120,150,255,.14);border:1px solid rgba(150,180,255,.36);border-radius:8px;padding:6px 11px;cursor:pointer}
button:hover{background:rgba(150,180,255,.28)}
button:disabled{opacity:.5;cursor:default}
button.on{background:#bfd8ff;color:#061027;border-color:#dbeaff;box-shadow:0 0 18px rgba(159,196,255,.4)}
.crumbs{display:flex;align-items:center;gap:3px;flex-wrap:nowrap;min-width:0;overflow:hidden}
.crumb{font:inherit;font-size:12px;color:#cfd8ff;background:transparent;border:0;border-radius:6px;padding:2px 5px;cursor:pointer;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.crumb:hover{background:rgba(150,180,255,.16)}
.crumb.current{color:#dbe8ff;font-weight:800}
.crumbs .sep{color:#5b648f;font-size:11px}
main{position:relative;min-height:0;overflow:hidden}
#bubbles-stage{position:absolute;inset:0;overflow:hidden;touch-action:none;cursor:default}
#bubbles-orb{position:absolute;inset:0;width:100%;height:100%;z-index:0;pointer-events:none}
#bubbles-core{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:2px;text-align:center;z-index:2;pointer-events:none;width:min(42vmin,380px)}
/* The core's white highlight sits just behind the name, so the letters carry their own deep gradient and a dark halo: they stay readable over both the highlight and the navy core. */
#bubbles-core-name{font-size:clamp(16px,3.3vmin,32px);font-weight:800;letter-spacing:.06em;text-transform:uppercase;background-image:linear-gradient(100deg,#7fa8ff 0%,#7286f0 18%,#9478ea 36%,#b375e2 54%,#d685d6 72%,#eda1dc 88%,#f7c9ec 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 1px rgba(2,3,9,.95)) drop-shadow(0 0 2px rgba(2,3,9,.92)) drop-shadow(0 0 4px rgba(2,3,9,.8)) drop-shadow(0 0 12px rgba(159,196,255,.3));max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#bubbles-core-sub{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#a8b6da;text-shadow:0 1px 6px rgba(0,0,0,.9)}
#bubbles-lines{position:absolute;inset:0;width:100%;height:100%;z-index:1;pointer-events:none;overflow:visible}
#bubbles-links{pointer-events:none}
#bubbles-layer{position:absolute;inset:0;z-index:3;touch-action:none;pointer-events:none}
#bubbles-empty{position:absolute;left:50%;bottom:20%;transform:translateX(-50%);text-align:center;color:#9fadd0;font-size:13px;max-width:340px;pointer-events:none;z-index:4;line-height:1.5}
#bubbles-gesture-hint{position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:35;padding:5px 13px;border-radius:999px;background:rgba(159,196,255,.14);border:1px solid rgba(159,196,255,.5);color:#dbe8ff;font-size:12px;pointer-events:none;letter-spacing:.03em}
#bubbles-status{min-height:24px;padding:2px 16px;font-size:12px;color:#9fadd0;border-top:1px solid rgba(140,170,255,.14);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#bubbles-status.bad{color:#ffb3c1}
.bubble{position:absolute;left:0;top:0;border-radius:50%;display:grid;place-items:center;text-align:center;cursor:grab;user-select:none;touch-action:none;color:#fff;will-change:transform;pointer-events:auto;
background:radial-gradient(circle at 50% 34%,rgba(255,255,255,.20),rgba(255,255,255,0) 46%),radial-gradient(circle at 50% 52%,var(--accent-deep,#101a3a) 0%,rgba(8,11,26,.9) 62%,rgba(4,5,12,.94) 100%);
border:1px solid var(--accent,#2f4d9e);box-shadow:0 0 22px -2px var(--accent),inset 0 0 26px rgba(0,0,0,.55);
transition:box-shadow .16s,border-color .16s}
.bubble::after{content:"";position:absolute;inset:9%;border-radius:50%;border:1px solid rgba(200,222,255,.16);box-shadow:inset 0 0 22px rgba(170,200,255,.08);pointer-events:none;animation:bubbles-breathe 5.5s ease-in-out infinite alternate}
.bubble:hover{box-shadow:0 0 32px var(--accent),inset 0 0 26px rgba(0,0,0,.5);border-color:var(--star)}
.bubble.selected{outline:2px solid var(--star);outline-offset:4px;box-shadow:0 0 34px var(--accent),0 0 0 6px rgba(159,196,255,.12),inset 0 0 26px rgba(0,0,0,.5)}
.bubble.source{outline:2px dashed var(--pink);outline-offset:5px;box-shadow:0 0 34px var(--pink)}
.bubble.dragging{cursor:grabbing;box-shadow:0 0 42px var(--accent)}
.bubble-label{font-weight:700;line-height:1.15;max-width:82%;max-height:64%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;word-break:break-word;color:#fff;text-shadow:0 1px 3px #000,0 0 12px rgba(0,0,0,.9)}
.bubble-badge{position:absolute;bottom:11%;left:50%;transform:translateX(-50%);font-size:max(9px,calc(var(--r,46px) * .16));letter-spacing:.07em;text-transform:uppercase;color:rgba(219,232,255,.72);text-shadow:0 1px 3px rgba(0,0,0,.9);white-space:nowrap}
.bubble-rename{position:absolute;left:8%;top:50%;transform:translateY(-50%);width:84%;font:inherit;font-weight:700;text-align:center;color:#fff;background:rgba(4,6,14,.96);border:1px solid var(--haze);border-radius:7px;padding:3px 5px;outline:none;z-index:2}
.bubble-tools{position:absolute;top:-2px;right:-2px;display:flex;gap:3px;opacity:0;transition:opacity .14s;z-index:3}
.bubble:hover .bubble-tools,.bubble.selected .bubble-tools,.bubble.renaming .bubble-tools{opacity:1}
.bubble-tool{width:20px;height:20px;padding:0;border-radius:50%;font-size:11px;line-height:1;display:grid;place-items:center;background:rgba(4,6,14,.92);border:1px solid rgba(150,180,255,.42);color:#dbe8ff}
.bubble-tool:hover{background:rgba(159,196,255,.28);border-color:var(--star);color:#fff}
@keyframes bubbles-breathe{from{transform:scale(.985);opacity:.7}to{transform:scale(1.02);opacity:1}}
.energy-halo{fill:none;stroke:url(#bubbles-energy);stroke-width:10;opacity:.16;stroke-linecap:round}
.energy-core{fill:none;stroke:url(#bubbles-energy);stroke-width:2;stroke-linecap:round;stroke-dasharray:9 9;animation:bubbles-flow 1.1s linear infinite}
.energy-spark{fill:none;stroke:var(--star);stroke-width:2;stroke-linecap:round;stroke-dasharray:1 27;animation:bubbles-flow .72s linear infinite;opacity:.9}
.energy-hit{fill:none;stroke:transparent;stroke-width:20;pointer-events:stroke;cursor:pointer}
.flow-kill{opacity:0;transition:opacity .14s;cursor:pointer;pointer-events:all}
.flow:hover .flow-kill{opacity:1}
.flow-kill circle{fill:rgba(4,6,14,.96);stroke:var(--haze);stroke-width:1}
.flow-kill text{fill:var(--haze);font:13px ui-sans-serif,system-ui;text-anchor:middle;dominant-baseline:central}
@keyframes bubbles-flow{to{stroke-dashoffset:-36}}
#bubbles-preview{fill:none;stroke:#bfd8ff;stroke-width:2;stroke-dasharray:6 7;opacity:.85;stroke-linecap:round;pointer-events:none}
/* The stage actions sit together at the bottom right, one size and one style: Connect, Run, + Bubble, Undo, Delete. */
#bubbles-dock{position:absolute;right:18px;bottom:18px;z-index:27;display:flex;gap:8px;align-items:stretch}
#bubbles-dock button{display:inline-flex;align-items:center;justify-content:center;min-width:104px;min-height:36px;padding:0 16px;border-radius:999px;font-size:13px;font-weight:800;line-height:1;letter-spacing:.02em;white-space:nowrap;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.5);background:linear-gradient(100deg,#3f5fd8,#7a6ce8 58%,#e07ad0);border:1px solid rgba(210,225,255,.7);box-shadow:0 8px 28px rgba(80,110,240,.4)}
#bubbles-dock button:hover{filter:brightness(1.1);background:linear-gradient(100deg,#4f6fe8,#8a7cf0 58%,#f08ada)}
#bubbles-dock button:disabled{filter:grayscale(.4);opacity:.55}
#bubbles-dock button.on{background:#bfd8ff;color:#061027;border-color:#dbeaff;text-shadow:none;box-shadow:0 0 18px rgba(159,196,255,.55)}
/* Delete is the one destructive mode: while it is on, every bubble a click lands on is removed at once. */
#bubbles-remove.on{background:#ffb3c1;color:#2a0713;border-color:#ffd6de;text-shadow:none;box-shadow:0 0 20px rgba(255,179,193,.6)}
#bubbles-editor{position:absolute;left:50%;bottom:66px;transform:translateX(-50%);width:min(760px,calc(100% - 230px));z-index:25;background:rgba(5,8,18,.96);border:1px solid rgba(159,196,255,.3);border-radius:14px;padding:10px 12px;display:flex;flex-direction:column;gap:7px;box-shadow:0 14px 46px rgba(0,0,0,.55);backdrop-filter:blur(8px)}
#bubbles-editor[hidden]{display:none}
.editor-head,.results-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.editor-head strong{font-size:13px;color:#dbe8ff;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.editor-head .grow{flex:1}
.editor-head button,.results-head button{font-size:12px;padding:4px 9px}
.check{display:flex;gap:5px;align-items:center;font-size:12px;color:#a8b6da;white-space:nowrap}
.check input{width:auto;accent-color:#9fc4ff}
#bubbles-code{width:100%;height:96px;min-height:58px;max-height:30vh;resize:vertical;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:#eef1ff;background:rgba(4,6,14,.96);border:1px solid rgba(140,170,255,.26);border-radius:9px;padding:8px;outline:none}
#bubbles-code:focus{border-color:rgba(159,196,255,.7);box-shadow:0 0 0 3px rgba(159,196,255,.14)}
#bubbles-editor .hint{margin:0;color:#9fadd0;font-size:11px}
#bubbles-results{position:absolute;left:16px;top:16px;width:min(430px,calc(100% - 220px));max-height:48vh;overflow:auto;z-index:26;background:rgba(5,8,18,.96);border:1px solid rgba(140,170,255,.26);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px;box-shadow:0 14px 46px rgba(0,0,0,.5);backdrop-filter:blur(8px)}
#bubbles-results[hidden]{display:none}
.results-head strong{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#cfd8ff}
#bubbles-results-summary{font-size:11px}
#bubbles-results-list{display:flex;flex-direction:column;gap:5px}
.run-step{border-left:3px solid rgba(140,170,255,.42);padding:4px 8px;background:rgba(8,12,28,.78);border-radius:0 7px 7px 0;display:flex;flex-direction:column;gap:2px}
.run-step.ok{border-color:#34d399}
.run-step.failed{border-color:#f87171}
.run-step.document,.run-step.empty,.run-step.container{border-color:#5b6f9a;color:#a8b6da}
.run-line{display:flex;gap:8px;align-items:baseline;font-size:12px;flex-wrap:wrap}
.run-path{font-weight:700;color:#dbe8ff}
.run-status{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#a8b6da}
.run-out{font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;color:#cbd7f5;max-height:170px;overflow:auto}
.muted{color:#9fadd0;font-size:12px}
@media (max-width:900px){
  #bubbles-editor{width:calc(100% - 32px);bottom:66px}
  #bubbles-results{width:calc(100% - 32px);max-height:32vh}
  #bubbles-dock{right:12px;bottom:12px;gap:6px}
  #bubbles-dock button{min-width:0;padding:0 9px;font-size:12px}
}
</style>
</head>
<body>
<div id="bubbles-app">
<header>
<h1 class="galaxy-title">Bubbles</h1>
<nav id="bubbles-crumbs" class="crumbs" aria-label="Where you are"></nav>
<p class="hint" id="bubbles-hint">Double-click a bubble to enter. Drag it to throw it; viscosity brings it to rest.</p>
<button id="bubbles-back" type="button" hidden>Back</button>
</header>
<main>
<div id="bubbles-stage">
<canvas id="bubbles-orb" aria-hidden="true"></canvas>
<div id="bubbles-core" aria-hidden="true"><span id="bubbles-core-name">Fuse</span><span id="bubbles-core-sub">root</span></div>
<svg id="bubbles-lines" aria-hidden="true">
<defs>
<linearGradient id="bubbles-energy" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#2f4d9e"></stop>
<stop offset=".38" stop-color="#6a7ae8"></stop>
<stop offset=".7" stop-color="#a06ae0"></stop>
<stop offset="1" stop-color="#e07ad0"></stop>
</linearGradient>
</defs>
<g id="bubbles-links"></g>
</svg>
<div id="bubbles-layer"></div>
<div id="bubbles-empty" hidden></div>
<div id="bubbles-gesture-hint" hidden>Keep circling clockwise to leave</div>
<div id="bubbles-dock" role="group" aria-label="Bubbles actions">
<button id="bubbles-connect" type="button">Connect</button>
<button id="bubbles-run" type="button">Run</button>
<button id="bubbles-add" type="button">+ Bubble</button>
<button id="bubbles-undo" type="button" disabled>Undo</button>
<button id="bubbles-remove" type="button">Delete</button>
</div>
<section id="bubbles-editor" hidden aria-label="Bubble code">
<div class="editor-head">
<strong id="bubbles-editor-name"></strong>
<span id="bubbles-editor-count" class="muted"></span>
<label class="check"><input id="bubbles-exec" type="checkbox"> runs as code</label>
<span class="grow"></span>
<button id="bubbles-run-here" type="button">Run here</button>
<button id="bubbles-save" type="button">Save</button>
</div>
<textarea id="bubbles-code" spellcheck="false" placeholder="Write a document, or a shell command when 'runs as code' is on."></textarea>
<p class="hint" id="bubbles-editor-hint">Code runs in the app folder, like a terminal. Keep it one command; use node -e "..." for a script.</p>
</section>
<section id="bubbles-results" hidden aria-label="Run results">
<div class="results-head">
<strong>Run order</strong>
<span id="bubbles-results-summary" class="muted"></span>
<span class="grow" style="flex:1"></span>
<button id="bubbles-results-close" type="button" title="Close results">×</button>
</div>
<div id="bubbles-results-list"></div>
</section>
</div>
</main>
<div id="bubbles-status" role="status" aria-live="polite"></div>
</div>
<script type="application/json" id="bubbles-initial">${JSON.stringify(initial).replaceAll('<', '\\u003c')}</script>
<script type="module">${client}</script>
</body>
</html>
`
}

export function apply(ctx: Context): void {
  const file = join(ctx.appInstance.home, `${name}.json`)
  let data = readData(file)
  const page = buildPage(readFileSync(new URL('./client.js', import.meta.url), 'utf8'))

  const commit = (next: BubblesData): BubblesData => {
    data = next
    writeData(file, next)
    return data
  }

  const requireJson = async (c: HttpContext): Promise<Record<string, unknown>> => {
    const body = await jsonBody(c)
    if (body === null) throw new StoreError(415, 'send this request as JSON')
    return body
  }

  // Undo keeps the mind as it was before each removal, so a removal can be put back exactly (ids, places, code and the run order with it).
  const undoStack: UndoPoint[] = []
  const remember = (label: string): void => {
    undoStack.push({ data: { bubbles: data.bubbles, links: data.links }, label })
    if (undoStack.length > UNDO_LIMIT) undoStack.shift()
  }

  const state = () => ({ bubbles: data.bubbles, links: data.links, canUndo: undoStack.length > 0 })

  const app = new Acryl()
    .get('/', (c) => c.html(page(state()), 200))
    .get('/state', (c) => c.json(state()))
    .post('/items', (c) =>
      guard(c, async () => {
        const body = await requireJson(c)
        const input: BubbleInput = {
          parentId: parentIdOf(body.parentId),
          ...(optionalText(body.name, 'name') === undefined ? {} : { name: optionalText(body.name, 'name') }),
          ...(optionalNumber(body.x, 'x') === undefined ? {} : { x: optionalNumber(body.x, 'x') }),
          ...(optionalNumber(body.y, 'y') === undefined ? {} : { y: optionalNumber(body.y, 'y') }),
          ...(optionalNumber(body.radius, 'radius') === undefined
            ? {}
            : { radius: optionalNumber(body.radius, 'radius') }),
          ...(optionalText(body.code, 'code') === undefined ? {} : { code: optionalText(body.code, 'code') }),
          ...(optionalBoolean(body.executable, 'executable') === undefined
            ? {}
            : { executable: optionalBoolean(body.executable, 'executable') }),
        }
        const made = addBubble(data, input)
        commit(made.data)
        return c.json({ ...state(), created: made.bubble.id })
      }),
    )
    .patch('/items/:id', (c) =>
      guard(c, async () => {
        const body = await requireJson(c)
        const patch: BubblePatch = {}
        if (body.name !== undefined) patch.name = optionalText(body.name, 'name') ?? ''
        if (body.code !== undefined) patch.code = optionalText(body.code, 'code') ?? ''
        if (body.executable !== undefined) {
          const executable = optionalBoolean(body.executable, 'executable')
          if (executable !== undefined) patch.executable = executable
        }
        const x = optionalNumber(body.x, 'x')
        if (x !== undefined) patch.x = x
        const y = optionalNumber(body.y, 'y')
        if (y !== undefined) patch.y = y
        const vx = optionalNumber(body.vx, 'vx')
        if (vx !== undefined) patch.vx = vx
        const vy = optionalNumber(body.vy, 'vy')
        if (vy !== undefined) patch.vy = vy
        const radius = optionalNumber(body.radius, 'radius')
        if (radius !== undefined) patch.radius = radius
        commit(patchBubble(data, c.req.param('id'), patch))
        return c.json(state())
      }),
    )
    .delete('/items/:id', (c) =>
      guard(c, async () => {
        await requireJson(c)
        const id = c.req.param('id')
        const removed = data.bubbles.find((bubble) => bubble.id === id)
        const next = removeBubble(data, id)
        remember(removed === undefined ? 'the bubble' : removed.name)
        commit(next)
        return c.json(state())
      }),
    )
    .post('/links', (c) =>
      guard(c, async () => {
        const body = await requireJson(c)
        const from = typeof body.from === 'string' ? body.from : ''
        const to = typeof body.to === 'string' ? body.to : ''
        if (from === '' || to === '') throw new StoreError(400, 'a line needs two bubbles')
        commit(addLink(data, from, to))
        return c.json(state())
      }),
    )
    .delete('/links/:id', (c) =>
      guard(c, async () => {
        await requireJson(c)
        const next = removeLink(data, c.req.param('id'))
        remember('the line')
        commit(next)
        return c.json(state())
      }),
    )
    .post('/undo', (c) =>
      guard(c, async () => {
        await requireJson(c)
        const point = undoStack.pop()
        if (point === undefined) throw new StoreError(409, 'nothing to undo')
        const back = restore(data, point.data)
        commit(back.data)
        return c.json({ ...state(), restored: back.restored, undone: point.label })
      }),
    )
    .post('/run', (c) =>
      guard(c, async () => {
        const body = await requireJson(c)
        const startId = parentIdOf(body.startId)
        if (startId !== null && !data.bubbles.some((bubble) => bubble.id === startId)) {
          throw new StoreError(404, 'no such bubble')
        }
        const address = getConnInfo(c).remote.address
        if (address !== undefined && !isLoopback(address)) {
          return c.json({ error: 'code runs only for a request from this machine' }, 403)
        }
        const plan = executionPlan(data, startId)
        const startedAt = Date.now()
        const steps: RunStep[] = []
        for (const step of plan) {
          const bubble = data.bubbles.find((candidate) => candidate.id === step.bubbleId)
          const base = {
            bubbleId: step.bubbleId,
            path: step.path,
            depth: step.depth,
            code: bubble?.code ?? '',
            executable: bubble?.executable === true,
          }
          if (bubble === undefined) {
            steps.push({
              ...base,
              status: 'skipped',
              exitCode: null,
              stdout: '',
              stderr: '',
              detail: 'this bubble was removed',
            })
            continue
          }
          const hasChildren = data.bubbles.some((candidate) => candidate.parentId === bubble.id)
          const isCode = bubble.executable && bubble.code.trim() !== ''
          if (!bubble.executable) {
            steps.push({
              ...base,
              status: bubble.code.trim() === '' ? (hasChildren ? 'container' : 'empty') : 'document',
              exitCode: null,
              stdout: '',
              stderr: '',
              detail:
                bubble.code.trim() === ''
                  ? hasChildren
                    ? 'a container; its bubbles run next'
                    : 'nothing written yet'
                  : 'a document, not code',
            })
            continue
          }
          if (!isCode) {
            steps.push({
              ...base,
              status: 'empty',
              exitCode: null,
              stdout: '',
              stderr: '',
              detail: 'runs as code but is empty',
            })
            continue
          }
          if (Date.now() - startedAt > RUN_BUDGET_MS) {
            steps.push({
              ...base,
              status: 'skipped',
              exitCode: null,
              stdout: '',
              stderr: '',
              detail: 'the run took too long',
            })
            continue
          }
          const run = await runCommand(bubble.code, ctx.appInstance.root)
          steps.push({ ...base, ...run, detail: '' })
        }
        return c.json({
          startId,
          startedAt: new Date(startedAt).toISOString(),
          finishedAt: new Date().toISOString(),
          steps,
        })
      }),
    )

  // The app is bubbles only: its page is the root and the older /bubbles address both.
  ctx.router.route('/', app)
  ctx.router.route('/bubbles', app)
}

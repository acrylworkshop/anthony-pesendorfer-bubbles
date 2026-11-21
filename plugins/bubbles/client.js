/**
 * The bubbles page module: a wavy core in the middle, bubbles that swim around it with friction, a document and code editor inside each bubble,
 * energized lines that set the run order, and the clockwise gesture that leaves a bubble.
 *
 * The plugin inlines this file into the page as one module, so it has no URL of its own and everything it asks for is written from the page's
 * own path (under the frame that path starts with `/app`). The geometry and gesture maths are exported, so a test checks them without a
 * browser; the page code only runs where there is a document.
 */

export const PALETTE = [
  '#04050b',
  '#101a3a',
  '#3a5ad0',
  '#5a6ae8',
  '#8a7cf0',
  '#b883e8',
  '#e88ad8',
  '#f6d9f2',
]

/** The faint rings of the core, from the blues out to the pinks: a constellation look on black. */
const RING_COLORS = ['#2f4d9e', '#4a63c8', '#6a7ae8', '#8f7cef', '#b383e6', '#d38de0', '#f0b6e4']

export const ROOT_NAME = 'Fuse'
const TAU = Math.PI * 2
/** How far a clockwise circle must turn inside 0.8 s before the page leaves the bubble: a little more than three quarters of a turn. */
export const EXIT_TURN = Math.PI * 1.75
const SVG_NS = 'http://www.w3.org/2000/svg'

export function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value))
}

/** A stable colour from the galaxy ramp, so a bubble keeps its colour as it moves. */
export function accentFor(key) {
  const text = String(key)
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) % 100000
  }
  return PALETTE[2 + (hash % 5)]
}

/** A colour mixed toward the page's near-black, so a bubble's middle stays dark and white text on it stays readable. */
export function deepen(hex, keep = 0.42) {
  const value = String(hex).replace('#', '')
  const ink = [4, 5, 11]
  const channels = [0, 2, 4].map((start) => Number.parseInt(value.slice(start, start + 2), 16))
  return `#${channels
    .map((channel, index) => Math.round(ink[index] + (channel - ink[index]) * keep).toString(16).padStart(2, '0'))
    .join('')}`
}

/** The curve of an energized line, bent a little to the side, and the point halfway along it for the little remove button. */
export function curveFor(from, to, bend = 0.16) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const cx = (from.x + to.x) / 2 - dy * bend
  const cy = (from.y + to.y) / 2 + dx * bend
  const mid = {
    x: 0.25 * from.x + 0.5 * cx + 0.25 * to.x,
    y: 0.25 * from.y + 0.5 * cy + 0.25 * to.y,
  }
  return { d: `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`, mid }
}

/**
 * How far the pointer has turned clockwise around `center` in the last `windowMs`, in radians. A point on the screen's top moving right is a
 * positive turn; that is the gesture that leaves a bubble. Counterclockwise cancels it out.
 */
export function clockwiseSweep(points, now, center, windowMs = 800) {
  const fresh = points.filter((point) => now - point.t <= windowMs && point.t <= now)
  if (fresh.length < 3) return 0
  let total = 0
  let previous = Math.atan2(fresh[0].y - center.y, fresh[0].x - center.x)
  for (let index = 1; index < fresh.length; index += 1) {
    const angle = Math.atan2(fresh[index].y - center.y, fresh[index].x - center.x)
    let delta = angle - previous
    while (delta > Math.PI) delta -= TAU
    while (delta < -Math.PI) delta += TAU
    total += delta
    previous = angle
  }
  return total
}

export function pathLabel(path) {
  return Array.isArray(path) ? path.join(' / ') : String(path)
}

/**
 * The clockwise exit gesture, measured around the middle of the path itself so it works anywhere on the stage. A circle is consistent in one
 * direction; a straight sweep or a back-and-forth wiggle is not, so it is not mistaken for the gesture.
 */
export function clockwiseGesture(points, now, windowMs = 800) {
  const fresh = points.filter((point) => now - point.t <= windowMs && point.t <= now)
  if (fresh.length < 6) return { turn: 0, progress: 0, circling: false, consistency: 0 }
  let centerX = 0
  let centerY = 0
  for (const point of fresh) {
    centerX += point.x
    centerY += point.y
  }
  centerX /= fresh.length
  centerY /= fresh.length
  let radiusSum = 0
  let radiusSquared = 0
  for (const point of fresh) {
    const distance = Math.hypot(point.x - centerX, point.y - centerY)
    radiusSum += distance
    radiusSquared += distance * distance
  }
  const meanRadius = radiusSum / fresh.length
  if (meanRadius < 14) return { turn: 0, progress: 0, circling: false, consistency: 0, radiusRatio: 1 }
  // A circle keeps a steady distance from its middle; a straight sweep does not.
  const deviation = Math.sqrt(Math.max(0, radiusSquared / fresh.length - meanRadius * meanRadius))
  const radiusRatio = meanRadius > 0 ? deviation / meanRadius : 1
  let positive = 0
  let negative = 0
  let previous = Math.atan2(fresh[0].y - centerY, fresh[0].x - centerX)
  for (let index = 1; index < fresh.length; index += 1) {
    const angle = Math.atan2(fresh[index].y - centerY, fresh[index].x - centerX)
    let delta = angle - previous
    while (delta > Math.PI) delta -= TAU
    while (delta < -Math.PI) delta += TAU
    if (delta >= 0) positive += delta
    else negative -= delta
    previous = angle
  }
  const swept = positive + negative
  const consistency = swept > 0 ? positive / swept : 0
  const turn = positive - negative
  const circling = consistency > 0.72 && positive > 0.5 && radiusRatio < 0.4
  return { turn, progress: circling ? clamp(turn / EXIT_TURN, 0, 1) : 0, circling, consistency, radiusRatio }
}

if (typeof document !== 'undefined') start()

function start() {
  const stage = document.getElementById('bubbles-stage')
  const layer = document.getElementById('bubbles-layer')
  const svg = document.getElementById('bubbles-lines')
  const linksGroup = document.getElementById('bubbles-links')
  const orbCanvas = document.getElementById('bubbles-orb')
  const crumbsEl = document.getElementById('bubbles-crumbs')
  const hintEl = document.getElementById('bubbles-hint')
  const coreEl = document.getElementById('bubbles-core')
  const coreName = document.getElementById('bubbles-core-name')
  const coreSub = document.getElementById('bubbles-core-sub')
  const emptyEl = document.getElementById('bubbles-empty')
  const gestureEl = document.getElementById('bubbles-gesture-hint')
  const statusEl = document.getElementById('bubbles-status')
  const addBtn = document.getElementById('bubbles-add')
  const backBtn = document.getElementById('bubbles-back')
  const connectBtn = document.getElementById('bubbles-connect')
  const runBtn = document.getElementById('bubbles-run')
  const undoBtn = document.getElementById('bubbles-undo')
  const removeBtn = document.getElementById('bubbles-remove')
  const editorEl = document.getElementById('bubbles-editor')
  const editorName = document.getElementById('bubbles-editor-name')
  const editorCount = document.getElementById('bubbles-editor-count')
  const codeInput = document.getElementById('bubbles-code')
  const execInput = document.getElementById('bubbles-exec')
  const runHereBtn = document.getElementById('bubbles-run-here')
  const saveBtn = document.getElementById('bubbles-save')
  const resultsEl = document.getElementById('bubbles-results')
  const resultsList = document.getElementById('bubbles-results-list')
  const resultsSummary = document.getElementById('bubbles-results-summary')
  const resultsClose = document.getElementById('bubbles-results-close')

  if (
    !(stage instanceof HTMLElement) ||
    layer === null ||
    svg === null ||
    linksGroup === null ||
    !(orbCanvas instanceof HTMLCanvasElement) ||
    crumbsEl === null ||
    hintEl === null ||
    coreEl === null ||
    coreName === null ||
    coreSub === null ||
    emptyEl === null ||
    gestureEl === null ||
    statusEl === null ||
    !(addBtn instanceof HTMLButtonElement) ||
    !(backBtn instanceof HTMLButtonElement) ||
    !(connectBtn instanceof HTMLButtonElement) ||
    !(runBtn instanceof HTMLButtonElement) ||
    !(undoBtn instanceof HTMLButtonElement) ||
    !(removeBtn instanceof HTMLButtonElement) ||
    editorEl === null ||
    editorName === null ||
    editorCount === null ||
    !(codeInput instanceof HTMLTextAreaElement) ||
    !(execInput instanceof HTMLInputElement) ||
    !(runHereBtn instanceof HTMLButtonElement) ||
    !(saveBtn instanceof HTMLButtonElement) ||
    resultsEl === null ||
    resultsList === null ||
    resultsSummary === null ||
    !(resultsClose instanceof HTMLButtonElement)
  ) {
    return
  }
  const ctx = orbCanvas.getContext('2d')
  if (ctx === null) return

  // The page answers at the app root and at /bubbles; the API always hangs under the mount as /bubbles.
  const PREFIX = location.pathname.replace(/\/bubbles\/?$/u, '').replace(/\/$/u, '')
  const API = `${PREFIX}/bubbles`

  let data = { bubbles: [], links: [] }
  // Undo is offered only while the app still holds a removal it can put back.
  let canUndo = false
  const initialEl = document.getElementById('bubbles-initial')
  if (initialEl !== null && initialEl.textContent !== null) {
    try {
      const parsed = JSON.parse(initialEl.textContent)
      if (Array.isArray(parsed.bubbles)) data.bubbles = parsed.bubbles
      if (Array.isArray(parsed.links)) data.links = parsed.links
      canUndo = parsed.canUndo === true
    } catch {
      // A page without its mind starts empty; the first change asks the app for the real one.
    }
  }

  const ui = {
    currentId: null,
    selectedId: null,
    renamingId: null,
    connectMode: false,
    connectFrom: null,
    deleteMode: false,
    pointer: { x: 0, y: 0 },
    editorDirty: false,
    running: false,
    gesture: 0,
  }

  let stageW = 0
  let stageH = 0
  let drag = null
  let lastTap = { id: null, t: 0 }
  let lastPointerHandled = { id: null, t: 0 }
  let gesturePoints = []
  let lastGestureAt = 0
  let saveTimer = null
  let saving = false
  let pendingDelete = null
  let deleteTimer = null
  let renameSession = null
  let editorBubbleId = null
  let previewEl = null
  let lastFrame = performance.now()

  const motion = new Map()
  const bubbleEls = new Map()
  const lineEls = new Map()

  const bubbleById = (id) => data.bubbles.find((bubble) => bubble.id === id) ?? null
  const childrenOf = (id) => data.bubbles.filter((bubble) => bubble.parentId === id)
  const currentBubble = () =>
    ui.currentId === null ? null : (data.bubbles.find((bubble) => bubble.id === ui.currentId) ?? null)
  const bubblesHere = () => data.bubbles.filter((bubble) => bubble.parentId === ui.currentId)
  const linksHere = () => data.links.filter((link) => link.parentId === ui.currentId)

  function setStatus(message, tone) {
    statusEl.textContent = message
    statusEl.className = tone === 'bad' ? 'bad' : ''
  }

  function hexA(hex, alpha) {
    const value = String(hex).replace('#', '')
    const red = Number.parseInt(value.slice(0, 2), 16)
    const green = Number.parseInt(value.slice(2, 4), 16)
    const blue = Number.parseInt(value.slice(4, 6), 16)
    return `rgba(${red},${green},${blue},${alpha})`
  }

  async function request(method, path, body, options = {}) {
    const apply = options.apply !== false
    let response
    try {
      response = await fetch(API + path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body === undefined ? {} : body),
      })
    } catch {
      setStatus('The app did not answer. Is it still running?', 'bad')
      return null
    }
    const answer = await response.json().catch(() => ({ error: `The app answered ${response.status}.` }))
    if (!response.ok) {
      setStatus(answer !== null && typeof answer.error === 'string' ? answer.error : `That did not work (${response.status}).`, 'bad')
      return null
    }
    if (apply && answer !== null && Array.isArray(answer.bubbles)) applyData(answer)
    return answer
  }

  function applyData(next) {
    if (typeof next.canUndo === 'boolean') {
      canUndo = next.canUndo
      undoBtn.disabled = !canUndo
    }
    data = {
      bubbles: Array.isArray(next.bubbles) ? next.bubbles : [],
      links: Array.isArray(next.links) ? next.links : [],
    }
    if (ui.currentId !== null && bubbleById(ui.currentId) === null) {
      ui.currentId = null
      motion.clear()
    }
    if (ui.selectedId !== null && bubbleById(ui.selectedId) === null) ui.selectedId = null
    if (ui.connectFrom !== null && bubbleById(ui.connectFrom) === null) {
      ui.connectFrom = null
      ui.connectMode = false
    }
    if (renameSession !== null && bubbleById(renameSession.id) === null) cancelRename()
    syncMotion()
    rebuildBubbles()
    rebuildLines()
    renderChrome()
    renderEditor()
    renderEmpty()
    paintSelection()
  }

  function radiusScale() {
    return Math.max(0.62, Math.min(1.2, Math.min(stageW, stageH) / 820))
  }

  function syncMotion() {
    const here = bubblesHere()
    const ids = new Set(here.map((bubble) => bubble.id))
    for (const id of [...motion.keys()]) if (!ids.has(id)) motion.delete(id)
    const scale = radiusScale()
    for (const bubble of here) {
      const existing = motion.get(bubble.id)
      if (existing === undefined) {
        motion.set(bubble.id, {
          x: bubble.x * stageW,
          y: bubble.y * stageH,
          vx: bubble.vx * stageW,
          vy: bubble.vy * stageH,
          radius: bubble.radius * scale,
          nextNudge: performance.now() + 2500 + Math.random() * 6000,
        })
      } else {
        existing.radius = bubble.radius * scale
      }
    }
  }

  function orbRadius() {
    return Math.max(58, Math.min(190, Math.min(stageW, stageH) * 0.16))
  }

  function resizeStage() {
    const width = stage.clientWidth
    const height = stage.clientHeight
    if (width === 0 || height === 0) return
    const oldW = stageW
    const oldH = stageH
    stageW = width
    stageH = height
    if (oldW > 0 && oldH > 0) {
      const sx = width / oldW
      const sy = height / oldH
      for (const item of motion.values()) {
        item.x *= sx
        item.y *= sy
        item.vx *= sx
        item.vy *= sy
      }
    } else {
      motion.clear()
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    orbCanvas.width = Math.max(1, Math.floor(width * dpr))
    orbCanvas.height = Math.max(1, Math.floor(height * dpr))
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    syncMotion()
    updateBubbleGeometry()
    updateLineGeometry()
  }

  function paintSelection() {
    for (const [id, el] of bubbleEls) {
      el.classList.toggle('selected', id === ui.selectedId)
      el.classList.toggle('source', id === ui.connectFrom)
    }
  }

  function rebuildBubbles() {
    layer.replaceChildren()
    bubbleEls.clear()
    for (const bubble of bubblesHere()) {
      const el = document.createElement('div')
      el.className = 'bubble'
      el.dataset.id = bubble.id
      const accent = accentFor(bubble.id)
      el.style.setProperty('--accent', accent)
      el.style.setProperty('--accent-deep', deepen(accent))

      const label = document.createElement('span')
      label.className = 'bubble-label'
      label.textContent = bubble.name

      const badge = document.createElement('span')
      badge.className = 'bubble-badge'
      const count = childrenOf(bubble.id).length
      badge.textContent = `${bubble.executable ? 'code' : 'doc'}${count > 0 ? ` · ${count}` : ''}`

      const rename = document.createElement('input')
      rename.className = 'bubble-rename'
      rename.maxLength = 80
      rename.hidden = true
      rename.setAttribute('aria-label', 'Bubble name')

      const tools = document.createElement('div')
      tools.className = 'bubble-tools'
      const renameButton = document.createElement('button')
      renameButton.type = 'button'
      renameButton.className = 'bubble-tool'
      renameButton.title = 'Rename'
      renameButton.textContent = '✎'
      const openButton = document.createElement('button')
      openButton.type = 'button'
      openButton.className = 'bubble-tool'
      openButton.title = 'Open'
      openButton.textContent = '↗'
      const deleteButton = document.createElement('button')
      deleteButton.type = 'button'
      deleteButton.className = 'bubble-tool'
      deleteButton.title = 'Delete'
      deleteButton.textContent = '×'
      tools.append(openButton, renameButton, deleteButton)

      el.append(label, badge, rename, tools)
      el.addEventListener('pointerdown', (event) => onBubblePointerDown(event, bubble.id))
      el.addEventListener('dblclick', (event) => {
        if (ui.connectMode) return
        if (event.target instanceof Element && event.target.closest('.bubble-tools, .bubble-rename')) return
        void enterBubble(bubble.id)
      })
      el.addEventListener('click', (event) => {
        if (event.target instanceof Element && event.target.closest('.bubble-tools, .bubble-rename')) return
        if (lastPointerHandled.id === bubble.id && performance.now() - lastPointerHandled.t < 700) {
          lastPointerHandled = { id: null, t: 0 }
          return
        }
        ui.selectedId = bubble.id
        paintSelection()
        if (ui.connectMode) {
          void handleConnectClick(bubble.id)
          return
        }
        selectBubble(bubble.id)
      })
      tools.addEventListener('pointerdown', (event) => event.stopPropagation())
      openButton.addEventListener('click', (event) => {
        event.stopPropagation()
        void enterBubble(bubble.id)
      })
      renameButton.addEventListener('click', (event) => {
        event.stopPropagation()
        startRename(bubble.id)
      })
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation()
        void deleteBubble(bubble.id)
      })
      // A click that no pointerdown started (a keyboard or a synthetic activation) still deletes while Delete is on.
      el.addEventListener('click', () => {
        if (!ui.deleteMode) return
        if (bubbleById(bubble.id) === null) return
        void removeBubbleNow(bubble.id)
      })

      layer.append(el)
      bubbleEls.set(bubble.id, el)
      if (renameSession !== null && renameSession.id === bubble.id) startRename(bubble.id)
    }
    paintSelection()
    updateBubbleGeometry()
  }

  function updateBubbleGeometry() {
    for (const [id, el] of bubbleEls) {
      const item = motion.get(id)
      if (item === undefined) continue
      const size = item.radius * 2
      el.style.width = `${size}px`
      el.style.height = `${size}px`
      el.style.setProperty('--r', `${item.radius}px`)
      el.style.transform = `translate3d(${item.x - item.radius}px, ${item.y - item.radius}px, 0)`
    }
  }

  function svgPath(className) {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('class', className)
    return path
  }

  function rebuildLines() {
    linksGroup.replaceChildren()
    lineEls.clear()
    for (const link of linksHere()) {
      const group = document.createElementNS(SVG_NS, 'g')
      group.setAttribute('class', 'flow')
      group.dataset.id = link.id
      const halo = svgPath('energy-halo')
      const core = svgPath('energy-core')
      const spark = svgPath('energy-spark')
      const hit = svgPath('energy-hit')
      const kill = document.createElementNS(SVG_NS, 'g')
      kill.setAttribute('class', 'flow-kill')
      const circle = document.createElementNS(SVG_NS, 'circle')
      circle.setAttribute('r', '9')
      const cross = document.createElementNS(SVG_NS, 'text')
      cross.textContent = '×'
      const title = document.createElementNS(SVG_NS, 'title')
      title.textContent = 'Remove this line'
      kill.append(circle, cross, title)
      hit.addEventListener('pointerdown', (event) => event.stopPropagation())
      kill.addEventListener('pointerdown', (event) => event.stopPropagation())
      kill.addEventListener('click', (event) => {
        event.stopPropagation()
        void removeFlow(link.id)
      })
      group.append(halo, core, spark, hit, kill)
      linksGroup.append(group)
      lineEls.set(link.id, { group, halo, core, spark, hit, kill })
    }
    previewEl = svgPath('bubbles-preview')
    previewEl.id = 'bubbles-preview'
    linksGroup.append(previewEl)
    updateLineGeometry()
  }

  function updateLineGeometry() {
    for (const link of linksHere()) {
      const el = lineEls.get(link.id)
      if (el === undefined) continue
      const a = motion.get(link.from)
      const b = motion.get(link.to)
      if (a === undefined || b === undefined) {
        el.group.style.display = 'none'
        continue
      }
      el.group.style.display = ''
      const curve = curveFor({ x: a.x, y: a.y }, { x: b.x, y: b.y })
      el.halo.setAttribute('d', curve.d)
      el.core.setAttribute('d', curve.d)
      el.spark.setAttribute('d', curve.d)
      el.hit.setAttribute('d', curve.d)
      el.kill.setAttribute('transform', `translate(${curve.mid.x} ${curve.mid.y})`)
    }
    if (previewEl !== null) {
      if (ui.connectMode && ui.connectFrom !== null) {
        const a = motion.get(ui.connectFrom)
        if (a === undefined) {
          previewEl.style.display = 'none'
        } else {
          previewEl.style.display = ''
          previewEl.setAttribute('d', curveFor({ x: a.x, y: a.y }, ui.pointer).d)
        }
      } else {
        previewEl.style.display = 'none'
      }
    }
  }

  function renderChrome() {
    const crumbs = []
    const root = document.createElement('button')
    root.type = 'button'
    root.className = `crumb${ui.currentId === null ? ' current' : ''}`
    root.textContent = ROOT_NAME
    root.addEventListener('click', () => {
      void setLevel(null, 'Back at the top level.')
    })
    crumbs.push(root)
    const path = ancestry()
    for (const bubble of path) {
      const sep = document.createElement('span')
      sep.className = 'sep'
      sep.textContent = '›'
      crumbs.push(sep)
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `crumb${ui.currentId === bubble.id ? ' current' : ''}`
      button.textContent = bubble.name
      button.addEventListener('click', () => {
        if (ui.currentId !== bubble.id) void enterBubble(bubble.id)
      })
      crumbs.push(button)
    }
    crumbsEl.replaceChildren(...crumbs)

    backBtn.hidden = ui.currentId === null
    if (ui.currentId === null) {
      hintEl.textContent =
        'Double-click a bubble to enter. Drag it to throw it; viscosity brings it to rest. Select and press Enter to rename.'
    } else {
      hintEl.textContent =
        'Circle clockwise for a moment to leave. Double-click a child to enter it. Connect lines to set the run order.'
    }

    const bubble = currentBubble()
    coreName.textContent = bubble === null ? ROOT_NAME : bubble.name
    coreSub.textContent = bubble === null ? 'root' : `${String(childrenOf(bubble.id).length)} inside`
    coreEl.style.setProperty('--accent', bubble === null ? '#cfe0ff' : accentFor(bubble.id))
  }

  function ancestry() {
    const path = []
    let cursor = currentBubble()
    const seen = new Set()
    while (cursor !== null) {
      if (seen.has(cursor.id)) break
      seen.add(cursor.id)
      path.unshift(cursor)
      cursor = cursor.parentId === null ? null : bubbleById(cursor.parentId)
    }
    return path
  }

  function renderEditor(force = false) {
    const bubble = currentBubble()
    if (bubble === null) {
      editorEl.hidden = true
      editorBubbleId = null
      ui.editorDirty = false
      return
    }
    editorEl.hidden = false
    editorName.textContent = bubble.name
    const count = childrenOf(bubble.id).length
    editorCount.textContent = count === 0 ? 'empty' : `${String(count)} inside`
    if (force || editorBubbleId !== bubble.id) {
      codeInput.value = bubble.code
      execInput.checked = bubble.executable
      editorBubbleId = bubble.id
      ui.editorDirty = false
    }
  }

  function renderEmpty() {
    const here = bubblesHere()
    if (here.length > 0) {
      emptyEl.hidden = true
      return
    }
    emptyEl.hidden = false
    emptyEl.textContent =
      ui.currentId === null
        ? 'The core is awake. Press + Bubble to make your first bubble.'
        : 'Nothing inside yet. Press + Bubble to add one here.'
  }

  function renderConnect() {
    connectBtn.classList.toggle('on', ui.connectMode)
    connectBtn.setAttribute('aria-pressed', ui.connectMode ? 'true' : 'false')
    if (ui.connectMode) {
      setStatus(ui.connectFrom === null ? 'Connect: click the bubble a line starts at.' : 'Connect: click the bubble the line runs to.')
    }
    updateLineGeometry()
  }

  function renderDeleteMode() {
    removeBtn.classList.toggle('on', ui.deleteMode)
    removeBtn.setAttribute('aria-pressed', ui.deleteMode ? 'true' : 'false')
    if (ui.deleteMode) setStatus('Delete: click a bubble to remove it and everything inside it.')
  }

  function onBubblePointerDown(event, id) {
    if (event.target instanceof Element && event.target.closest('.bubble-tools, .bubble-rename')) return
    if (event.button !== 0 && event.pointerType === 'mouse') return
    event.stopPropagation()
    const bubble = bubbleById(id)
    const el = bubbleEls.get(id)
    const item = motion.get(id)
    if (bubble === null || el === undefined || item === undefined) return
    lastPointerHandled = { id, t: performance.now() }
    ui.selectedId = id
    paintSelection()
    if (ui.connectMode) {
      void handleConnectClick(id)
      return
    }
    if (ui.deleteMode) {
      void removeBubbleNow(id)
      return
    }
    const rect = stage.getBoundingClientRect()
    drag = {
      id,
      pointerType: event.pointerType,
      offsetX: event.clientX - rect.left - item.x,
      offsetY: event.clientY - rect.top - item.y,
      startX: item.x,
      startY: item.y,
      lastT: performance.now(),
      moved: false,
      longPress: 0,
    }
    el.classList.add('dragging')
    drag.longPress = window.setTimeout(() => {
      if (drag !== null && drag.id === id && !drag.moved) {
        drag = null
        endDragListeners()
        const current = bubbleEls.get(id)
        if (current !== undefined) current.classList.remove('dragging')
        startRename(id)
      }
    }, 650)
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
    window.addEventListener('pointercancel', onDragEnd)
  }

  function onDragMove(event) {
    if (drag === null) return
    const item = motion.get(drag.id)
    if (item === undefined) return
    const rect = stage.getBoundingClientRect()
    const now = performance.now()
    const nx = clamp(event.clientX - rect.left - drag.offsetX, 0, stageW)
    const ny = clamp(event.clientY - rect.top - drag.offsetY, 0, stageH)
    if (Math.hypot(nx - drag.startX, ny - drag.startY) > 4) {
      drag.moved = true
      if (drag.longPress !== 0) {
        clearTimeout(drag.longPress)
        drag.longPress = 0
      }
    }
    const dt = Math.max(0.001, (now - drag.lastT) / 1000)
    item.vx = clamp((nx - item.x) / dt, -2600, 2600)
    item.vy = clamp((ny - item.y) / dt, -2600, 2600)
    item.x = nx
    item.y = ny
    drag.lastT = now
  }

  function onDragEnd() {
    if (drag === null) return
    const finished = drag
    drag = null
    endDragListeners()
    if (finished.longPress !== 0) clearTimeout(finished.longPress)
    const el = bubbleEls.get(finished.id)
    if (el !== undefined) el.classList.remove('dragging')
    const item = motion.get(finished.id)
    const now = performance.now()
    if (item !== undefined) {
      if (now - finished.lastT > 160) {
        item.vx = 0
        item.vy = 0
      }
      void persistBubble(finished.id)
    }
    if (!finished.moved) {
      selectBubble(finished.id)
      if (finished.pointerType !== 'mouse') {
        if (lastTap.id === finished.id && now - lastTap.t < 380) {
          lastTap = { id: null, t: 0 }
          void enterBubble(finished.id)
        } else {
          lastTap = { id: finished.id, t: now }
        }
      }
    }
  }

  function endDragListeners() {
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragEnd)
    window.removeEventListener('pointercancel', onDragEnd)
  }

  function selectBubble(id) {
    ui.selectedId = id
    paintSelection()
    const bubble = bubbleById(id)
    if (bubble !== null) {
      setStatus(`Selected ${bubble.name}. Press Enter to rename, Delete to remove, or double-click to enter.`)
    }
  }

  async function persistBubble(id) {
    const item = motion.get(id)
    if (item === undefined || stageW === 0 || stageH === 0) return
    const answer = await request(
      'PATCH',
      `/items/${id}`,
      {
        x: item.x / stageW,
        y: item.y / stageH,
        vx: item.vx / stageW,
        vy: item.vy / stageH,
      },
      { apply: false },
    )
    if (answer === null) return
    const bubble = bubbleById(id)
    if (bubble !== null) {
      bubble.x = item.x / stageW
      bubble.y = item.y / stageH
      bubble.vx = item.vx / stageW
      bubble.vy = item.vy / stageH
    }
  }

  async function setLevel(id, message) {
    await flushEditor()
    if (renameSession !== null) cancelRename()
    ui.currentId = id
    ui.selectedId = null
    ui.connectMode = false
    ui.connectFrom = null
    ui.gesture = 0
    gesturePoints = []
    gestureEl.hidden = true
    lastTap = { id: null, t: 0 }
    motion.clear()
    syncMotion()
    rebuildBubbles()
    rebuildLines()
    renderChrome()
    renderEditor(true)
    renderEmpty()
    paintSelection()
    renderConnect()
    if (message !== undefined) setStatus(message)
  }

  async function enterBubble(id) {
    if (ui.connectMode) return
    const bubble = bubbleById(id)
    if (bubble === null) return
    await setLevel(id, `Inside ${bubble.name}. Circle clockwise for a moment to leave, or press Back.`)
  }

  async function exitBubble() {
    const bubble = currentBubble()
    if (bubble === null) return
    const parentId = bubble.parentId
    const parent = parentId === null ? null : bubbleById(parentId)
    await setLevel(parentId, parent === null ? 'Back at the top level.' : `Back in ${parent.name}.`)
  }

  function startRename(id) {
    const bubble = bubbleById(id)
    const el = bubbleEls.get(id)
    if (bubble === null || el === undefined) return
    if (renameSession !== null) cancelRename()
    const input = el.querySelector('.bubble-rename')
    const label = el.querySelector('.bubble-label')
    if (!(input instanceof HTMLInputElement) || !(label instanceof HTMLElement)) return
    ui.renamingId = id
    el.classList.add('renaming')
    input.hidden = false
    label.hidden = true
    input.value = bubble.name
    input.focus()
    input.select()
    const onKey = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        input.blur()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancelRename()
      }
    }
    const onBlur = () => {
      void commitRename(id, input.value)
    }
    input.addEventListener('keydown', onKey)
    input.addEventListener('blur', onBlur)
    renameSession = { id, input, label, onKey, onBlur }
  }

  function cancelRename() {
    if (renameSession === null) {
      ui.renamingId = null
      return
    }
    const session = renameSession
    renameSession = null
    ui.renamingId = null
    session.input.removeEventListener('keydown', session.onKey)
    session.input.removeEventListener('blur', session.onBlur)
    session.input.hidden = true
    session.label.hidden = false
    const bubble = bubbleById(session.id)
    if (bubble !== null) session.label.textContent = bubble.name
    const el = bubbleEls.get(session.id)
    if (el !== undefined) el.classList.remove('renaming')
  }

  async function commitRename(id, raw) {
    const bubble = bubbleById(id)
    if (renameSession !== null && renameSession.id === id) {
      const session = renameSession
      renameSession = null
      ui.renamingId = null
      session.input.removeEventListener('keydown', session.onKey)
      session.input.removeEventListener('blur', session.onBlur)
      session.input.hidden = true
      session.label.hidden = false
      const el = bubbleEls.get(id)
      if (el !== undefined) el.classList.remove('renaming')
    }
    const name = String(raw).replace(/\s+/gu, ' ').trim().slice(0, 80)
    if (bubble === null || name === '' || name === bubble.name) return
    const answer = await request('PATCH', `/items/${id}`, { name })
    if (answer === null) return
    setStatus(`Renamed to ${name}.`)
  }

  async function deleteBubble(id) {
    const bubble = bubbleById(id)
    if (bubble === null) return
    if (!window.confirm(`Remove ${bubble.name} and everything inside it?`)) return
    if (renameSession !== null) cancelRename()
    await flushEditor()
    if (ui.currentId === id) ui.currentId = bubble.parentId
    const answer = await request('DELETE', `/items/${id}`)
    if (answer !== null) setStatus(`Removed ${bubble.name}.`)
  }

  async function removeBubbleNow(id) {
    if (renameSession !== null && renameSession.id === id) cancelRename()
    await flushEditor()
    const name = bubbleById(id)?.name ?? 'the bubble'
    const answer = await request('DELETE', `/items/${id}`)
    if (answer === null) return
    setStatus(`Removed ${name}. Click another bubble, or press Delete again to stop.`)
  }

  async function undoLast() {
    if (!canUndo) return
    await flushEditor()
    const answer = await request('POST', '/undo', {})
    if (answer === null) {
      canUndo = false
      undoBtn.disabled = true
      return
    }
    const back = Array.isArray(answer.restored) ? answer.restored : []
    setStatus(
      back.length === 0
        ? `Restored ${typeof answer.undone === 'string' ? answer.undone : 'the last removal'}.`
        : `Restored ${back.join(', ')}.`,
    )
  }

  function scheduleSave() {
    ui.editorDirty = true
    if (saveTimer !== null) clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => {
      saveTimer = null
      void saveEditor()
    }, 650)
  }

  async function flushEditor() {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    while (saving) await new Promise((resolve) => setTimeout(resolve, 60))
    if (!ui.editorDirty) return
    await saveEditor()
    while (saving) await new Promise((resolve) => setTimeout(resolve, 60))
  }

  async function saveEditor() {
    const bubble = currentBubble()
    if (bubble === null) {
      ui.editorDirty = false
      return
    }
    if (saving) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      if (!ui.editorDirty) return
    }
    if (!ui.editorDirty) return
    const id = bubble.id
    const code = codeInput.value.slice(0, 20_000)
    const executable = execInput.checked
    ui.editorDirty = false
    saving = true
    const answer = await request('PATCH', `/items/${id}`, { code, executable }, { apply: false })
    saving = false
    if (answer === null) {
      ui.editorDirty = true
      return
    }
    const fresh = bubbleById(id)
    if (fresh !== null) {
      fresh.code = code
      fresh.executable = executable
    }
    setStatus(executable ? 'Saved. This bubble runs as code.' : 'Saved as a document.')
  }

  async function addBubbleHere() {
    if (ui.running) return
    if (renameSession !== null) cancelRename()
    await flushEditor()
    const answer = await request('POST', '/items', { parentId: ui.currentId })
    if (answer === null || typeof answer.created !== 'string') return
    ui.selectedId = answer.created
    paintSelection()
    startRename(answer.created)
    setStatus('Name your bubble, then press Enter.')
  }

  async function handleConnectClick(id) {
    if (!ui.connectMode) return
    if (ui.connectFrom === null) {
      ui.connectFrom = id
      paintSelection()
      updateLineGeometry()
      setStatus('Now click the bubble the line should run to.')
      return
    }
    if (ui.connectFrom === id) {
      ui.connectFrom = null
      paintSelection()
      updateLineGeometry()
      setStatus('Line cancelled.')
      return
    }
    const from = ui.connectFrom
    ui.connectFrom = null
    paintSelection()
    const answer = await request('POST', '/links', { from, to: id })
    if (answer !== null) {
      ui.connectMode = false
      renderConnect()
      setStatus('Connected. The run follows the lines.')
    }
  }

  async function removeFlow(id) {
    const answer = await request('DELETE', `/links/${id}`)
    if (answer !== null) setStatus('Line removed.')
  }

  function statusText(status) {
    if (status === 'ok') return 'ran'
    if (status === 'failed') return 'failed'
    if (status === 'skipped') return 'skipped'
    if (status === 'document') return 'document'
    if (status === 'empty') return 'empty'
    if (status === 'container') return 'container'
    return status
  }

  function showResults(answer) {
    resultsEl.hidden = false
    resultsList.replaceChildren()
    const steps = Array.isArray(answer.steps) ? answer.steps : []
    const counts = { ok: 0, failed: 0, skipped: 0 }
    for (const step of steps) {
      if (step.status === 'ok') counts.ok += 1
      else if (step.status === 'failed') counts.failed += 1
      else if (step.status === 'skipped') counts.skipped += 1
    }
    resultsSummary.textContent = `${String(steps.length)} steps · ${String(counts.ok)} ran · ${String(counts.failed)} failed`
    for (const step of steps) {
      const item = document.createElement('div')
      item.className = `run-step ${String(step.status)}`
      const line = document.createElement('div')
      line.className = 'run-line'
      const path = document.createElement('span')
      path.className = 'run-path'
      path.textContent = pathLabel(step.path)
      const status = document.createElement('span')
      status.className = 'run-status'
      status.textContent = statusText(step.status)
      line.append(path, status)
      if (typeof step.detail === 'string' && step.detail !== '') {
        const detail = document.createElement('span')
        detail.className = 'muted'
        detail.textContent = step.detail
        line.append(detail)
      }
      item.append(line)
      const pieces = []
      if (typeof step.code === 'string' && step.code.trim() !== '' && (step.status === 'ok' || step.status === 'failed')) {
        pieces.push(`$ ${step.code.trim()}`)
      }
      if (typeof step.stdout === 'string' && step.stdout.trim() !== '') pieces.push(step.stdout)
      if (typeof step.stderr === 'string' && step.stderr.trim() !== '') pieces.push(step.stderr)
      if (pieces.length > 0) {
        const output = document.createElement('div')
        output.className = 'run-out'
        output.textContent = pieces.join('\n')
        item.append(output)
      }
      resultsList.append(item)
    }
    if (steps.length === 0) {
      const none = document.createElement('p')
      none.className = 'muted'
      none.textContent = 'There is nothing at this level to run yet.'
      resultsList.append(none)
    }
  }

  async function runFrom(startId) {
    if (ui.running) return
    if (renameSession !== null) cancelRename()
    await flushEditor()
    ui.running = true
    runBtn.disabled = true
    runHereBtn.disabled = true
    setStatus(startId === null ? 'Running the whole mind in order...' : 'Running this bubble and the bubbles inside it...')
    const answer = await request('POST', '/run', { startId })
    ui.running = false
    runBtn.disabled = false
    runHereBtn.disabled = false
    if (answer === null) return
    showResults(answer)
    const ran = answer.steps.filter((step) => step.status === 'ok' || step.status === 'failed')
    const failed = ran.filter((step) => step.status === 'failed').length
    const skipped = answer.steps.filter((step) => step.status === 'skipped').length
    setStatus(
      ran.length === 0
        ? 'Nothing ran. Turn on "runs as code" and write a command inside a bubble.'
        : `Ran ${String(ran.length)} code bubble${ran.length === 1 ? '' : 's'} in order${failed > 0 ? `, ${String(failed)} failed` : ''}${skipped > 0 ? `, ${String(skipped)} skipped` : ''}.`,
      failed > 0 ? 'bad' : '',
    )
  }

  function stepPhysics(dt, now) {
    if (stageW === 0 || stageH === 0) return
    if (ui.connectMode || renameSession !== null) {
      // The bubbles hold still while a line is drawn or a name is typed, so a click lands on the bubble it aims at.
      for (const item of motion.values()) {
        item.vx = 0
        item.vy = 0
      }
      return
    }
    const here = bubblesHere()
    const cx = stageW / 2
    const cy = stageH / 2
    const orb = orbRadius()
    for (const bubble of here) {
      const item = motion.get(bubble.id)
      if (item === undefined) continue
      if (drag !== null && drag.id === bubble.id) continue
      if (now >= item.nextNudge) {
        const angle = Math.random() * TAU
        const speed = 26 + Math.random() * 44
        item.vx += Math.cos(angle) * speed
        item.vy += Math.sin(angle) * speed
        item.nextNudge = now + 4500 + Math.random() * 7000
      }
      const dx = item.x - cx
      const dy = item.y - cy
      const distance = Math.hypot(dx, dy)
      const floor = orb + item.radius + 14
      if (distance < floor) {
        if (distance > 0.001) {
          item.x = cx + (dx / distance) * floor
          item.y = cy + (dy / distance) * floor
          const normal = (item.vx * dx + item.vy * dy) / distance
          if (normal < 0) {
            item.vx -= (dx / distance) * normal * 1.6
            item.vy -= (dy / distance) * normal * 1.6
          }
        } else {
          item.x = cx + floor
        }
      }
      const damping = Math.exp(-2.3 * dt)
      item.vx *= damping
      item.vy *= damping
      if (Math.abs(item.vx) < 0.3) item.vx = 0
      if (Math.abs(item.vy) < 0.3) item.vy = 0
      item.x += item.vx * dt
      item.y += item.vy * dt
      const minX = item.radius + 8
      const maxX = stageW - item.radius - 8
      const minY = item.radius + 8
      const maxY = stageH - item.radius - 8
      if (minX >= maxX || minY >= maxY) {
        item.x = stageW / 2
        item.y = stageH / 2
        continue
      }
      if (item.x < minX) {
        item.x = minX
        item.vx = Math.abs(item.vx) * 0.6
      }
      if (item.x > maxX) {
        item.x = maxX
        item.vx = -Math.abs(item.vx) * 0.6
      }
      if (item.y < minY) {
        item.y = minY
        item.vy = Math.abs(item.vy) * 0.6
      }
      if (item.y > maxY) {
        item.y = maxY
        item.vy = -Math.abs(item.vy) * 0.6
      }
    }
    for (let first = 0; first < here.length; first += 1) {
      const a = motion.get(here[first].id)
      if (a === undefined) continue
      for (let second = first + 1; second < here.length; second += 1) {
        const b = motion.get(here[second].id)
        if (b === undefined) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const minimum = a.radius + b.radius + 4
        const squared = dx * dx + dy * dy
        if (squared >= minimum * minimum || squared === 0) continue
        const distance = Math.sqrt(squared)
        const nx = dx / distance
        const ny = dy / distance
        const push = (minimum - distance) / 2
        if (!(drag !== null && drag.id === here[first].id)) {
          a.x -= nx * push
          a.y -= ny * push
        }
        if (!(drag !== null && drag.id === here[second].id)) {
          b.x += nx * push
          b.y += ny * push
        }
        const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
        if (relative < 0) {
          const impulse = -relative * 0.5
          a.vx -= impulse * nx
          a.vy -= impulse * ny
          b.vx += impulse * nx
          b.vy += impulse * ny
        }
      }
    }
  }

  function wobblyPath(cx, cy, base, now, seed, amount) {
    const path = new Path2D()
    const steps = 180
    for (let index = 0; index <= steps; index += 1) {
      const angle = (index / steps) * TAU
      const wobble =
        1 +
        Math.sin(angle * 3 + now * 0.0011 + seed) * amount +
        Math.sin(angle * 5 - now * 0.0017 + seed * 1.9) * amount * 0.6
      const radius = base * wobble
      const x = cx + Math.cos(angle) * radius
      const y = cy + Math.sin(angle) * radius
      if (index === 0) path.moveTo(x, y)
      else path.lineTo(x, y)
    }
    path.closePath()
    return path
  }

  function drawOrb(now) {
    if (stageW === 0 || stageH === 0) return
    ctx.clearRect(0, 0, stageW, stageH)
    const cx = stageW / 2
    const cy = stageH / 2
    const radius = orbRadius()
    const bubble = currentBubble()
    const accent = bubble === null ? '#cfe0ff' : accentFor(bubble.id)

    const glow = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 2.3)
    glow.addColorStop(0, hexA(accent, 0.16))
    glow.addColorStop(0.45, hexA(accent, 0.06))
    glow.addColorStop(1, 'rgba(4,5,11,0)')
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 2.3, 0, TAU)
    ctx.fill()

    ctx.save()
    ctx.lineJoin = 'round'
    for (let ring = 0; ring < 7; ring += 1) {
      const base = radius * (0.4 + ring * 0.088)
      const path = wobblyPath(cx, cy, base, now, ring * 1.7, 0.028)
      const color = RING_COLORS[ring % RING_COLORS.length]
      ctx.strokeStyle = hexA(color, 0.26 + ring * 0.045)
      ctx.lineWidth = ring === 6 ? 2 : 1.2
      ctx.shadowColor = ring === 6 ? accent : 'transparent'
      ctx.shadowBlur = ring === 6 ? 18 : 0
      ctx.stroke(path)
    }
    ctx.restore()

    const core = wobblyPath(cx, cy, radius * 0.78, now, 0.4, 0.05)
    const fill = ctx.createRadialGradient(cx - radius * 0.24, cy - radius * 0.3, radius * 0.04, cx, cy, radius * 0.92)
    fill.addColorStop(0, 'rgba(255,255,255,0.55)')
    fill.addColorStop(0.18, hexA(deepen(accent, 0.8), 0.95))
    fill.addColorStop(0.58, '#1a2150')
    fill.addColorStop(1, '#04050b')
    ctx.save()
    ctx.shadowColor = accent
    ctx.shadowBlur = 34
    ctx.fillStyle = fill
    ctx.fill(core)
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, radius * 0.72, 0, TAU)
    ctx.clip()
    for (let line = 0; line < 6; line += 1) {
      ctx.beginPath()
      const y0 = cy - radius * 0.5 + line * radius * 0.2
      for (let x = cx - radius * 0.85; x <= cx + radius * 0.85; x += 4) {
        const phase = (x - cx) / radius
        const wave =
          Math.sin(phase * 7 + now * 0.0018 + line * 0.9) * radius * 0.045 +
          Math.sin(phase * 15 - now * 0.0026 + line * 1.7) * radius * 0.018
        const y = y0 + wave
        if (x === cx - radius * 0.85) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.strokeStyle = line % 2 === 0 ? hexA('#9fc4ff', 0.3) : hexA('#f2a6e0', 0.28)
      ctx.lineWidth = 1.1
      ctx.stroke()
    }
    ctx.restore()

    ctx.save()
    ctx.strokeStyle = hexA('#dbe8ff', 0.5)
    ctx.lineWidth = 1.5
    ctx.shadowColor = accent
    ctx.shadowBlur = 16
    ctx.stroke(wobblyPath(cx, cy, radius * 0.97, now, 2.1, 0.06))
    ctx.restore()

    // Orbiting light points: plain stars, not beads, so the core reads like a small galaxy on black.
    ctx.save()
    ctx.shadowColor = '#bcd4ff'
    ctx.shadowBlur = 9
    for (let particle = 0; particle < 22; particle += 1) {
      const angle = (particle / 22) * TAU + now * 0.00022 * (1 + (particle % 3) * 0.4)
      const speed = 0.72 + (((particle * 37) % 100) / 100) * 0.34
      const distance = radius * speed
      const alpha = 0.22 + Math.abs(Math.sin(now * 0.0013 + particle * 1.3)) * 0.6
      ctx.fillStyle = hexA(particle % 4 === 0 ? '#f6d9f2' : particle % 2 === 0 ? '#dbe8ff' : '#ffffff', alpha)
      ctx.beginPath()
      ctx.arc(
        cx + Math.cos(angle) * distance,
        cy + Math.sin(angle) * distance,
        0.8 + (particle % 3) * 0.55,
        0,
        TAU,
      )
      ctx.fill()
    }
    ctx.restore()

    if (ui.gesture > 0.015) {
      ctx.save()
      ctx.strokeStyle = '#9fc4ff'
      ctx.lineWidth = 3
      ctx.lineCap = 'round'
      ctx.shadowColor = '#9fc4ff'
      ctx.shadowBlur = 14
      ctx.beginPath()
      ctx.arc(cx, cy, radius * 1.14, -Math.PI / 2, -Math.PI / 2 + TAU * ui.gesture)
      ctx.stroke()
      ctx.restore()
    }
  }

  function onStagePointerMove(event) {
    const rect = stage.getBoundingClientRect()
    ui.pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
    if (ui.connectFrom !== null) updateLineGeometry()
    if (drag !== null) return
    if (ui.currentId === null) {
      ui.gesture = 0
      gestureEl.hidden = true
      return
    }
    if (event.target instanceof Element && event.target.closest('#bubbles-editor, #bubbles-results, button')) return
    const now = performance.now()
    gesturePoints.push({ t: now, x: ui.pointer.x, y: ui.pointer.y })
    if (gesturePoints.length > 180) gesturePoints.shift()
    lastGestureAt = now
    const fresh = gesturePoints.filter((point) => now - point.t <= 800)
    if (fresh.length < 6) {
      ui.gesture = 0
      gestureEl.hidden = true
      return
    }
    const gesture = clockwiseGesture(gesturePoints, now, 800)
    ui.gesture = Number.isFinite(gesture.progress) ? clamp(gesture.progress, 0, 1) : 0
    gestureEl.hidden = !gesture.circling || ui.gesture < 0.12
    if (ui.gesture >= 1) {
      gesturePoints = []
      ui.gesture = 0
      gestureEl.hidden = true
      void exitBubble()
    }
  }

  function onKeyDown(event) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
    if (event.key === 'Escape') {
      if (ui.deleteMode) {
        ui.deleteMode = false
        renderDeleteMode()
        setStatus('Delete off.')
        return
      }
      if (ui.connectMode) {
        ui.connectMode = false
        ui.connectFrom = null
        paintSelection()
        renderConnect()
        setStatus('Connect off.')
        return
      }
      if (ui.selectedId !== null) {
        ui.selectedId = null
        paintSelection()
      }
      return
    }
    if (event.key === 'Enter' && ui.selectedId !== null) {
      event.preventDefault()
      startRename(ui.selectedId)
      return
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault()
      void undoLast()
      return
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && ui.selectedId !== null) {
      event.preventDefault()
      const id = ui.selectedId
      if (pendingDelete === id) {
        if (deleteTimer !== null) clearTimeout(deleteTimer)
        deleteTimer = null
        pendingDelete = null
        void deleteBubble(id)
        return
      }
      pendingDelete = id
      if (deleteTimer !== null) clearTimeout(deleteTimer)
      deleteTimer = window.setTimeout(() => {
        pendingDelete = null
        deleteTimer = null
      }, 2600)
      const bubble = bubbleById(id)
      setStatus(`Press Delete again to remove ${bubble === null ? 'this bubble' : bubble.name} and everything inside it.`)
    }
  }

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastFrame) / 1000))
    lastFrame = now
    stepPhysics(dt, now)
    updateBubbleGeometry()
    updateLineGeometry()
    if (now - lastGestureAt > 250 && ui.gesture > 0) {
      ui.gesture = Math.max(0, ui.gesture * Math.exp(-dt * 5))
      gestureEl.hidden = ui.gesture < 0.08
    }
    drawOrb(now)
    requestAnimationFrame(frame)
  }

  addBtn.addEventListener('click', () => {
    void addBubbleHere()
  })
  backBtn.addEventListener('click', () => {
    void exitBubble()
  })
  connectBtn.addEventListener('click', () => {
    ui.connectMode = !ui.connectMode
    ui.connectFrom = null
    ui.selectedId = null
    if (ui.connectMode && ui.deleteMode) {
      ui.deleteMode = false
      renderDeleteMode()
    }
    paintSelection()
    renderConnect()
    if (!ui.connectMode) setStatus('Connect off.')
  })
  undoBtn.addEventListener('click', () => {
    void undoLast()
  })
  runBtn.addEventListener('click', () => {
    void runFrom(null)
  })
  removeBtn.addEventListener('click', () => {
    ui.deleteMode = !ui.deleteMode
    if (ui.deleteMode) {
      ui.connectMode = false
      ui.connectFrom = null
    }
    ui.selectedId = null
    paintSelection()
    renderConnect()
    renderDeleteMode()
    if (!ui.deleteMode) setStatus('Delete off.')
  })
  runHereBtn.addEventListener('click', () => {
    if (ui.currentId !== null) void runFrom(ui.currentId)
  })
  saveBtn.addEventListener('click', () => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    ui.editorDirty = true
    void saveEditor()
  })
  codeInput.addEventListener('input', scheduleSave)
  execInput.addEventListener('change', scheduleSave)
  resultsClose.addEventListener('click', () => {
    resultsEl.hidden = true
  })
  stage.addEventListener('pointerdown', (event) => {
    if (
      event.target instanceof Element &&
      event.target.closest('.bubble, #bubbles-editor, #bubbles-results, button')
    ) {
      return
    }
    if (ui.connectFrom !== null) {
      ui.connectFrom = null
      paintSelection()
      updateLineGeometry()
    }
    if (ui.selectedId !== null) {
      ui.selectedId = null
      paintSelection()
    }
  })
  stage.addEventListener('pointermove', onStagePointerMove)
  stage.addEventListener('pointerleave', () => {
    lastGestureAt = performance.now() - 400
  })
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('resize', resizeStage)
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resizeStage).observe(stage)
  }

  resizeStage()
  syncMotion()
  rebuildBubbles()
  rebuildLines()
  renderChrome()
  renderEditor(true)
  renderEmpty()
  paintSelection()
  renderConnect()
  undoBtn.disabled = !canUndo
  setStatus('Drag a bubble to throw it; viscosity brings it to rest. Double-click to enter; press Enter on a selected bubble to rename.')
  requestAnimationFrame(frame)
}

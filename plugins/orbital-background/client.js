/**
 * Hydrogen orbital probability clouds as a page background: white light points on a black sky.
 *
 * Each dot is one sample of |psi_nlm|^2 for a real hydrogen orbital: its distance from the nucleus follows the
 * radial distribution r^2 |R_nl(r)|^2 and its direction follows |Y_lm|^2. Every point is white, so the clouds read
 * as star clusters; the one phase keeps the faintest blue so depth and the sign of the wavefunction still show.
 *
 * Five clouds fill the page: one in the middle and one in each corner, the corners a little smaller, each a step
 * further along the orbital ladder. The top-left and bottom-right clouds sit further away (smaller, dimmer,
 * painted first) and the top-right and bottom-left ones closer (larger, brighter, painted last), so the page
 * reads as depth.
 *
 * Turning the pointer clockwise around a cloud morphs the ladder forward and turns the clouds with your hand;
 * counterclockwise runs it backwards, and a wheel scrolled down counts as a clockwise turn. The ladder loops, so
 * past 4f comes 1s again, and two full circles walk the whole set.
 *
 * This file is self-contained (no imports) because the plugin inlines it into every HTML page. Its physics is
 * exported so the app's test can check the sampling without a browser; the canvas starts only in a browser.
 * Never write a closing script tag in this file: it is inlined into a script element.
 */

/** The orbitals the background climbs through: [n, l, m] in the real spherical harmonic form. */
export const LEVELS = [
  { n: 1, l: 0, m: 0, label: '1s' },
  { n: 2, l: 0, m: 0, label: '2s' },
  { n: 2, l: 1, m: 0, label: '2p_z' },
  { n: 3, l: 0, m: 0, label: '3s' },
  { n: 3, l: 1, m: 1, label: '3p_x' },
  { n: 3, l: 2, m: 0, label: '3d_z2' },
  { n: 3, l: 2, m: -2, label: '3d_xy' },
  { n: 4, l: 1, m: 0, label: '4p_z' },
  { n: 4, l: 3, m: 0, label: '4f_z3' },
]

/** Pointer turning, in radians, that climbs one orbital level: two full clockwise circles walk the whole ladder. */
export const RADIANS_PER_LEVEL = (4 * Math.PI) / LEVELS.length

/**
 * The orbital level for a signed pointer turn (radians): clockwise adds, counterclockwise subtracts, and the
 * ladder loops, so a turn past 4f lands on 1s and a turn back past 1s lands on 4f. 1.4 is 40% of the morph from
 * level 1 to level 2.
 */
export function levelFor(turn) {
  const level = turn / RADIANS_PER_LEVEL
  return ((level % LEVELS.length) + LEVELS.length) % LEVELS.length
}

/**
 * The five clouds: a corner pair far away (top-left, bottom-right), the centre, and a near pair (top-right,
 * bottom-left). `x` and `y` are fractions of the window, `radius` a fraction of its shorter side, `share` the part
 * of the sampled points this cloud draws, `dot` and `alpha` its size and strength, `depth` its place in the paint
 * order (-1 far, 0 middle, 1 near), and `offset` its step along the orbital ladder. Painter's order: far first.
 */
export const CLOUDS = [
  { id: 'top-left', x: 0.21, y: 0.26, radius: 0.17, share: 0.38, dot: 0.55, alpha: 0.4, depth: -1, offset: 2, phase: 1.3, stagger: 0.37 },
  { id: 'bottom-right', x: 0.79, y: 0.74, radius: 0.17, share: 0.38, dot: 0.55, alpha: 0.4, depth: -1, offset: 8, phase: 3.1, stagger: 0.61 },
  { id: 'centre', x: 0.5, y: 0.52, radius: 0.3, share: 1, dot: 1, alpha: 1, depth: 0, offset: 0, phase: 0, stagger: 0 },
  { id: 'top-right', x: 0.855, y: 0.17, radius: 0.27, share: 0.58, dot: 1.18, alpha: 1, depth: 1, offset: 4, phase: 2.2, stagger: 0.19 },
  { id: 'bottom-left', x: 0.145, y: 0.83, radius: 0.27, share: 0.58, dot: 1.18, alpha: 1, depth: 1, offset: 6, phase: 4.4, stagger: 0.83 },
]

/** The light of a point, by sign of the wavefunction: both white, the one very slightly blue so the clouds keep depth. */
export const POINT_COLORS = [
  [255, 255, 255],
  [232, 240, 255],
]

/** The sky behind the points: near black, so the clouds read as stars. */
export const SKY = '#04050b'

/** A wheel notch of about 100 css pixels is half an orbital: scrolling down is a clockwise turn, scrolling up runs it back. */
export const WHEEL_RADIANS_PER_PIXEL = RADIANS_PER_LEVEL / 200

/** The signed turn a wheel movement of `deltaY` css pixels is worth: positive (clockwise) when the wheel goes down. */
export function spinForWheel(deltaY) {
  return deltaY * WHEEL_RADIANS_PER_PIXEL
}

/** A small seeded random generator, so a cloud is the same cloud after a resize or a reload. */
export function randomSource(seed) {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function factorial(k) {
  let result = 1
  for (let i = 2; i <= k; i++) result *= i
  return result
}

/** Generalized Laguerre polynomial L_k^alpha(x) by its three-term recurrence. */
export function laguerre(k, alpha, x) {
  if (k <= 0) return 1
  let previous = 1
  let current = 1 + alpha - x
  for (let i = 2; i <= k; i++) {
    const next = ((2 * i - 1 + alpha - x) * current - (i - 1 + alpha) * previous) / i
    previous = current
    current = next
  }
  return current
}

/** The radial part R_nl(r) up to a constant, in Bohr radii: rho^l e^(-rho/2) L(n-l-1, 2l+1, rho) with rho = 2r/n. */
export function radial(n, l, r) {
  const rho = (2 * r) / n
  return Math.pow(rho, l) * Math.exp(-rho / 2) * laguerre(n - l - 1, 2 * l + 1, rho)
}

/** Associated Legendre polynomial P_l^m(x) for m >= 0. */
export function legendre(l, m, x) {
  let pmm = 1
  if (m > 0) {
    const root = Math.sqrt(Math.max(0, 1 - x * x))
    let factor = 1
    for (let i = 1; i <= m; i++) {
      pmm *= -factor * root
      factor += 2
    }
  }
  if (l === m) return pmm
  let pmmp1 = x * (2 * m + 1) * pmm
  if (l === m + 1) return pmmp1
  let pll = 0
  for (let ll = m + 2; ll <= l; ll++) {
    pll = ((2 * ll - 1) * x * pmmp1 - (ll + m - 1) * pmm) / (ll - m)
    pmm = pmmp1
    pmmp1 = pll
  }
  return pll
}

/** A real spherical harmonic: Y_lm(theta, phi) with z = cos(theta), m of either sign (cos for m > 0, sin for m < 0). */
export function realY(l, m, z, phi) {
  const order = Math.abs(m)
  const p = legendre(l, order, z)
  const norm = Math.sqrt(((2 * l + 1) / (4 * Math.PI)) * (factorial(l - order) / factorial(l + order)))
  if (m === 0) return norm * p
  const scaled = Math.SQRT2 * norm * p
  return m > 0 ? scaled * Math.cos(order * phi) : scaled * Math.sin(order * phi)
}

/** The cumulative radial distribution of r^2 |R_nl|^2 over [0, 8n^2 + 6] Bohr radii, in `bins` steps. */
export function radialTable(n, l, bins = 2400) {
  const rmax = 8 * n * n + 6
  const dr = rmax / bins
  const cdf = new Float64Array(bins + 1)
  let total = 0
  for (let i = 1; i <= bins; i++) {
    const r = (i - 0.5) * dr
    const value = radial(n, l, r)
    total += value * value * r * r * dr
    cdf[i] = total
  }
  if (total > 0) for (let i = 0; i <= bins; i++) cdf[i] /= total
  return { cdf, rmax, bins }
}

function sampleRadius(table, random) {
  const u = random()
  let lo = 0
  let hi = table.bins
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (table.cdf[mid] < u) lo = mid + 1
    else hi = mid
  }
  const dr = table.rmax / table.bins
  return (lo - 0.5 + random()) * dr
}

/** The largest |Y_lm|^2 over the sphere: the rejection sampler's ceiling. */
export function angularMax(l, m) {
  let max = 0
  const steps = 160
  for (let i = 0; i <= steps; i++) {
    const z = 1 - (2 * i) / steps
    for (let j = 0; j < steps; j++) {
      const phi = (2 * Math.PI * j) / steps
      const value = realY(l, m, z, phi)
      if (value * value > max) max = value * value
    }
  }
  return max > 0 ? max : 1
}

/**
 * `count` samples of |psi_nlm|^2, positions normalized to a root mean square radius of 1 (so every orbital is
 * framed alike), with each point's phase (0 for a positive wavefunction, 1 for a negative one) and the true
 * mean radius in Bohr radii for the test to check against <r> = (3n^2 - l(l+1)) / 2.
 */
export function sampleOrbital(n, l, m, count, seed = 1) {
  const random = randomSource(seed)
  const table = radialTable(n, l)
  const ceiling = angularMax(l, m)
  const positions = new Float32Array(count * 3)
  const phase = new Float32Array(count)
  let radiusSum = 0
  let radiusSquareSum = 0
  for (let i = 0; i < count; i++) {
    const r = sampleRadius(table, random)
    let z = 1 - 2 * random()
    let phi = 2 * Math.PI * random()
    let angular = realY(l, m, z, phi)
    // Reject until the direction is drawn from |Y|^2, then keep that very direction: the arc is the sample.
    for (let tries = 0; tries < 64 && random() * ceiling > angular * angular; tries++) {
      z = 1 - 2 * random()
      phi = 2 * Math.PI * random()
      angular = realY(l, m, z, phi)
    }
    const ring = Math.sqrt(Math.max(0, 1 - z * z))
    radiusSum += r
    radiusSquareSum += r * r
    positions[i * 3] = r * ring * Math.cos(phi)
    positions[i * 3 + 1] = r * ring * Math.sin(phi)
    positions[i * 3 + 2] = r * z
    phase[i] = radial(n, l, r) * angular >= 0 ? 0 : 1
  }
  const rms = Math.sqrt(radiusSquareSum / count) || 1
  const scale = 1 / rms
  for (let i = 0; i < positions.length; i++) positions[i] *= scale
  return { positions, phase, rmsRadius: rms, meanRadius: radiusSum / count }
}

function start() {
  const canvas = document.querySelector('canvas[data-orbital-background]')
  if (!(canvas instanceof HTMLCanvasElement)) return
  const context = canvas.getContext('2d')
  if (context === null) return
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const STEPS = 12
  const sprite = (amount) => {
    // Both phases are white light: a bright core and a soft halo, so a point reads as a star.
    const from = POINT_COLORS[0]
    const to = POINT_COLORS[1]
    const red = Math.round(from[0] + (to[0] - from[0]) * amount)
    const green = Math.round(from[1] + (to[1] - from[1]) * amount)
    const blue = Math.round(from[2] + (to[2] - from[2]) * amount)
    const tile = document.createElement('canvas')
    tile.width = 32
    tile.height = 32
    const paint = tile.getContext('2d')
    if (paint === null) return tile
    const gradient = paint.createRadialGradient(16, 16, 0, 16, 16, 16)
    gradient.addColorStop(0, `rgba(${red},${green},${blue},1)`)
    gradient.addColorStop(0.24, `rgba(${red},${green},${blue},0.9)`)
    gradient.addColorStop(0.58, `rgba(${red},${green},${blue},0.32)`)
    gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`)
    paint.fillStyle = gradient
    paint.fillRect(0, 0, 32, 32)
    return tile
  }
  const sprites = []
  for (let i = 0; i < STEPS; i++) sprites.push(sprite(i / (STEPS - 1)))

  let width = 0
  let height = 0
  let pointCount = 0
  let clouds = new Map()
  let jitterSize = new Float32Array(0)
  let jitterAlpha = new Float32Array(0)
  let jitterStagger = new Float32Array(0)
  /** How far the pointer has turned around the cloud, signed: clockwise adds, counterclockwise subtracts. */
  let spin = 0
  /** The eased orbital level shown, always inside [0, LEVELS.length). */
  let level = 0
  /** The pointer's own turning speed, so the cloud turns with the hand that turns it. */
  let turn = 0
  let yaw = 0.4
  let pointerX = 0.5
  let pointerY = 0.5
  let lastAngle = null
  let lastMove = 0
  let frame = 0
  let running = false
  let previous = 0

  const cloudAt = (index) => {
    const orbital = LEVELS[index < 0 ? 0 : index > LEVELS.length - 1 ? LEVELS.length - 1 : index]
    const key = `${orbital.label}:${pointCount}`
    let cloud = clouds.get(key)
    if (cloud === undefined) {
      const seed = [...key].reduce((hash, character) => (hash * 31 + character.charCodeAt(0)) >>> 0, 7)
      cloud = sampleOrbital(orbital.n, orbital.l, orbital.m, pointCount, seed)
      clouds.set(key, cloud)
    }
    return cloud
  }

  const measure = () => {
    width = window.innerWidth
    height = window.innerHeight
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.round(width * dpr))
    canvas.height = Math.max(1, Math.round(height * dpr))
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    const next = Math.min(4200, Math.max(1400, Math.round((width * height) / 280)))
    if (next !== pointCount) {
      pointCount = next
      clouds = new Map()
      const random = randomSource(1234567)
      jitterSize = new Float32Array(pointCount)
      jitterAlpha = new Float32Array(pointCount)
      jitterStagger = new Float32Array(pointCount)
      for (let i = 0; i < pointCount; i++) {
        jitterSize[i] = random()
        jitterAlpha[i] = random()
        jitterStagger[i] = random()
      }
    }
  }

  const drawCloud = (cloud, baseAngle, tilt) => {
    const localLevel = (level + cloud.offset) % LEVELS.length
    const near = Math.floor(localLevel)
    // Every cloud walks the same loop at its own step, so the seam wrap applies to each of them.
    const far = (near + 1) % LEVELS.length
    const mix = localLevel - near
    const from = cloudAt(near)
    const to = cloudAt(far)
    const drawn = Math.round(pointCount * cloud.share)
    if (drawn <= 0) return

    const angle = baseAngle + cloud.phase
    const cosYaw = Math.cos(angle)
    const sinYaw = Math.sin(angle)
    const cosTilt = Math.cos(tilt)
    const sinTilt = Math.sin(tilt)
    const centreX = width * cloud.x
    const centreY = height * cloud.y
    const radius = Math.min(width, height) * cloud.radius
    const growth = 1 + localLevel * 0.03
    const focal = 3.4
    const fade = (0.9 + Math.min(0.35, localLevel * 0.04)) * cloud.dot
    const shift = Math.round(cloud.stagger * pointCount)
    const ax = from.positions
    const bx = to.positions
    const aphase = from.phase
    const bphase = to.phase
    for (let i = 0; i < drawn; i++) {
      // Each cloud morphs on its own timing, so the five of them do not dissolve in lockstep.
      const stagger = jitterStagger[(i + shift) % pointCount]
      let part = (mix - stagger * 0.35) / 0.65
      part = part < 0 ? 0 : part > 1 ? 1 : part
      const ease = part * part * (3 - 2 * part)
      const x = (ax[i * 3] + (bx[i * 3] - ax[i * 3]) * ease) * growth
      const y = (ax[i * 3 + 1] + (bx[i * 3 + 1] - ax[i * 3 + 1]) * ease) * growth
      const z = (ax[i * 3 + 2] + (bx[i * 3 + 2] - ax[i * 3 + 2]) * ease) * growth
      const rx = x * cosYaw - y * sinYaw
      const ry = x * sinYaw + y * cosYaw
      const depth = ry * cosTilt - z * sinTilt
      const rise = ry * sinTilt + z * cosTilt
      const perspective = focal / (focal + depth)
      const sx = centreX + rx * radius * perspective
      const sy = centreY - rise * radius * perspective
      if (sx < -24 || sx > width + 24 || sy < -24 || sy > height + 24) continue
      const reach = depth > 1.3 ? 0 : depth < -1.3 ? 1 : (1.3 - depth) / 2.6
      const hue = aphase[i] + (bphase[i] - aphase[i]) * ease
      const tile = sprites[Math.round(hue * (STEPS - 1))]
      const size = (1.15 + jitterSize[i] * 2.35) * perspective * fade * (0.75 + reach * 0.35)
      context.globalAlpha = (0.34 + reach * 0.42) * (0.42 + jitterAlpha[i] * 0.58) * cloud.alpha
      context.drawImage(tile, sx - size / 2, sy - size / 2, size, size)
    }
    context.globalAlpha = 1
  }

  const render = (dt) => {
    context.clearRect(0, 0, width, height)
    if (pointCount === 0) return
    // A slow clockwise drift, plus whatever the hand (or the wheel) is doing right now.
    yaw += (0.16 + turn) * dt
    const baseAngle = yaw + (pointerX - 0.5) * 0.8
    const tilt = -0.2 + (pointerY - 0.5) * 0.55

    // Deep space first: a flat near-black sky, so the page's text keeps its contrast and the points read as stars.
    context.fillStyle = SKY
    context.fillRect(0, 0, width, height)

    // Far clouds first, then the centre, then the near ones: the paint order is the depth order.
    for (const cloud of CLOUDS) drawCloud(cloud, baseAngle, tilt)
  }

  const tick = (now) => {
    if (!running) return
    const dt = previous === 0 ? 1 / 60 : Math.min(0.05, (now - previous) / 1000)
    previous = now
    // Ease towards the level the pointer has turned to, the short way round the loop (4f to 1s crosses the seam).
    let step = levelFor(spin) - level
    if (step > LEVELS.length / 2) step -= LEVELS.length
    else if (step < -LEVELS.length / 2) step += LEVELS.length
    level = (((level + step * Math.min(1, dt * 9)) % LEVELS.length) + LEVELS.length) % LEVELS.length
    // The hand's turning speed fades out when the pointer stops; the slow drift carries on.
    turn *= Math.exp(-dt * 2.6)
    render(dt)
    frame = requestAnimationFrame(tick)
  }

  const wake = () => {
    if (running || still || document.hidden) return
    running = true
    previous = 0
    frame = requestAnimationFrame(tick)
  }
  const sleep = () => {
    running = false
    cancelAnimationFrame(frame)
  }

  // A wheel scrolled down counts as a clockwise turn of the pointer, and scrolls the page as usual.
  const onWheel = (event) => {
    const delta = spinForWheel(event.deltaY)
    if (delta === 0) return
    spin += delta
    lastAngle = null
    // The clouds turn with the wheel while it moves, in the direction it names.
    turn = turn * 0.5 + (delta > 0 ? 1.5 : -1.5) * 0.5
    if (still) {
      level = levelFor(spin)
      render(0)
    }
  }

  const onPointer = (event) => {
    pointerX = event.clientX / Math.max(1, window.innerWidth)
    pointerY = event.clientY / Math.max(1, window.innerHeight)
    // The angle is read around the cloud's centre; too close to the nucleus there is no direction to read.
    const dx = event.clientX - width / 2
    const dy = event.clientY - height * 0.52
    if (Math.hypot(dx, dy) < 90) {
      lastAngle = null
      return
    }
    const angle = Math.atan2(dy, dx)
    if (lastAngle !== null) {
      let delta = angle - lastAngle
      if (delta > Math.PI) delta -= 2 * Math.PI
      else if (delta < -Math.PI) delta += 2 * Math.PI
      // A jump the pointer cannot make in one step (a window change, a lost frame) is not a turn.
      if (Math.abs(delta) < 0.9) {
        spin += delta
        const now = performance.now()
        const seconds = Math.max(0.008, Math.min(0.2, (now - lastMove) / 1000))
        lastMove = now
        // Positive is clockwise on screen (screen y points down): the cloud turns with the hand.
        turn = turn * 0.82 + (delta / seconds) * 0.18
        turn = turn < -5 ? -5 : turn > 5 ? 5 : turn
      }
    }
    lastAngle = angle
    if (still) {
      level = levelFor(spin)
      render(0)
    }
  }

  let resizeTimer = 0
  const onResize = () => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      measure()
      if (still) render(0)
    }, 180)
  }

  measure()
  window.addEventListener('pointermove', onPointer, { passive: true })
  window.addEventListener('wheel', onWheel, { passive: true })
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', () => (document.hidden ? sleep() : wake()))
  // A read-only handle for the page's console and for the app's checks: which orbital is shown, and how far the pointer has turned.
  window.orbitalBackground = {
    levels: LEVELS,
    get level() {
      return level
    },
    get spin() {
      return spin
    },
  }
  if (still) render(0)
  else wake()
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') start()

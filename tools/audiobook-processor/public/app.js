const $ = (id) => document.getElementById(id)

const state = {
  presets: {},
  files: [],
  outputs: [],
  selected: null,
  probe: null,
  chapters: [],
  folderTouched: false,
  job: null,
  jobSource: null,
  genericTitles: false,
}

// ---------- helpers ----------

/** Tiny DOM builder: never use innerHTML with data coming from audio tags. */
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value)
    else if (key === 'className') el.className = value
    else if (key in el && typeof value !== 'string') el[key] = value
    else el.setAttribute(key, value === true ? '' : value)
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue
    el.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return el
}

const formatTime = (seconds) => {
  const s = Math.max(0, Math.round(seconds))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hh > 0 ? `${hh}:${pad(mm)}:${pad(ss)}` : `${mm}:${pad(ss)}`
}

const formatDuration = (seconds) => {
  const hh = Math.floor(seconds / 3600)
  const mm = Math.round((seconds % 3600) / 60)
  return hh > 0 ? `${hh} h ${mm} min` : `${mm} min`
}

const formatBytes = (bytes) => {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`
}

let toastTimer
const toast = (message, isError = false) => {
  const el = $('toast')
  el.textContent = message
  el.className = `toast${isError ? ' error' : ''}`
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 6000 : 3000)
}

const api = async (path, options = {}) => {
  const res = await fetch(path, {
    ...options,
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`)
  return data
}

const debounce = (fn, ms) => {
  let t
  return (...args) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

const selectedChapters = () => state.chapters.filter((c) => c.include)

/**
 * Generic titles are derived, never stored: the original/edited title survives in c.title
 * so turning the option off restores it. Numbering follows the selected position and uses
 * the same zero-padding as the file prefix (lib/naming.ts chapterFileName).
 */
const displayTitle = (chapter) => {
  if (!state.genericTitles || !chapter.include) return chapter.title
  const selected = selectedChapters()
  const width = Math.max(2, String(selected.length).length)
  return `Capítulo ${String(selected.indexOf(chapter) + 1).padStart(width, '0')}`
}

// ---------- status & files ----------

const loadStatus = async () => {
  const status = await api('/api/status')
  state.presets = status.presets
  const ok = status.tools.ffmpeg.available && status.tools.ffprobe.available
  const pill = $('tool-status')
  pill.textContent = ok ? status.tools.ffmpeg.version.replace(/ Copyright.*/, '') : 'ffmpeg no disponible'
  pill.className = `pill ${ok ? 'ok' : 'error'}`
  $('ffmpeg-missing').hidden = ok
  renderPresets()
}

const loadFiles = async () => {
  const { files, outputs } = await api('/api/files')
  state.files = files
  state.outputs = outputs
  renderFiles()
}

const renderFiles = () => {
  const list = $('file-list')
  list.replaceChildren(
    ...state.files.map((f) =>
      h(
        'li',
        { className: f.name === state.selected ? 'active' : '', onclick: () => selectFile(f.name) },
        h('span', {}, f.name),
        h('span', { className: 'muted small' }, formatBytes(f.sizeBytes)),
      ),
    ),
  )
  $('file-list-empty').hidden = state.files.length > 0
  $('output-list').replaceChildren(
    ...(state.outputs.length
      ? state.outputs.map((name) =>
          h('li', { title: 'Abrir en Finder', onclick: () => openFolder('output', name) }, `📁 ${name}`),
        )
      : [h('li', { className: 'muted' }, 'Nada todavía')]),
  )
}

const openFolder = (target, folder) => api('/api/open', { method: 'POST', body: { target, folder } }).catch((e) => toast(e.message, true))

// ---------- upload ----------

const uploadFile = (file) =>
  new Promise((resolve, reject) => {
    const bar = $('upload-progress')
    bar.hidden = false
    bar.firstElementChild.style.width = '0%'
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/upload?name=${encodeURIComponent(file.name)}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) bar.firstElementChild.style.width = `${(e.loaded / e.total) * 100}%`
    }
    xhr.onload = () => {
      bar.hidden = true
      if (xhr.status >= 200 && xhr.status < 300) resolve(file.name)
      else reject(new Error(JSON.parse(xhr.responseText || '{}').error ?? `Error ${xhr.status}`))
    }
    xhr.onerror = () => {
      bar.hidden = true
      reject(new Error('Fallo de red al subir el fichero'))
    }
    xhr.send(file)
  })

const handleFiles = async (fileList) => {
  const files = [...fileList]
  let last
  for (const file of files) {
    try {
      toast(`Copiando ${file.name}…`)
      last = await uploadFile(file)
    } catch (e) {
      toast(e.message, true)
    }
  }
  await loadFiles()
  if (last) await selectFile(last)
}

const setupDropzone = () => {
  const zone = $('dropzone')
  zone.addEventListener('dragover', (e) => {
    e.preventDefault()
    zone.classList.add('over')
  })
  zone.addEventListener('dragleave', () => zone.classList.remove('over'))
  zone.addEventListener('drop', (e) => {
    e.preventDefault()
    zone.classList.remove('over')
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files)
  })
  $('file-input').addEventListener('change', (e) => {
    if (e.target.files?.length) handleFiles(e.target.files)
    e.target.value = ''
  })
}

// ---------- selection & book ----------

const selectFile = async (name) => {
  state.selected = name
  renderFiles()
  $('empty-state').hidden = false
  $('empty-state').firstElementChild.textContent = `Analizando ${name}…`
  $('editor').hidden = true
  try {
    const probe = await api(`/api/probe?file=${encodeURIComponent(name)}`)
    state.probe = probe
    state.folderTouched = false
    state.chapters = probe.chapters.map((c) => ({ ...c, include: c.end - c.start >= 1 }))
    renderBook()
    renderChapters()
    renderPreviewChapters()
    renderSummary()
    if (!state.job || state.job.status !== 'running') $('job').hidden = true
    $('empty-state').hidden = true
    $('editor').hidden = false
  } catch (e) {
    $('empty-state').firstElementChild.textContent = `No se pudo leer el fichero: ${e.message}`
  }
}

const renderBook = () => {
  const p = state.probe
  $('meta-title').value = p.meta.title
  $('meta-author').value = p.meta.author
  $('meta-narrator').value = p.meta.narrator
  $('folder-name').value = p.folderName
  $('folder-warning').hidden = !p.folderExists

  const cover = $('cover')
  if (p.cover) {
    cover.src = `/api/cover?file=${encodeURIComponent(p.file)}`
    cover.hidden = false
    $('cover-placeholder').hidden = true
  } else {
    cover.hidden = true
    $('cover-placeholder').hidden = false
  }

  const stat = (label, value) => h('div', {}, h('dt', {}, label), h('dd', {}, value))
  $('book-stats').replaceChildren(
    stat('Duración', formatDuration(p.duration)),
    stat('Capítulos', String(p.chapters.length || 'ninguno')),
    stat('Audio', `${p.codec.toUpperCase()}${p.bitrate ? ` · ${Math.round(p.bitrate / 1000)} kbps` : ''}`),
    stat('Canales', p.channels === 1 ? 'Mono' : p.channels === 2 ? 'Estéreo' : String(p.channels ?? '?')),
    stat('Tamaño', formatBytes(p.sizeBytes)),
  )
}

const refreshFolderName = debounce(async () => {
  if (state.folderTouched) return
  const params = new URLSearchParams({
    title: $('meta-title').value,
    author: $('meta-author').value,
    narrator: $('meta-narrator').value,
  })
  const { folderName, folderExists } = await api(`/api/folder-name?${params}`)
  $('folder-name').value = folderName
  $('folder-warning').hidden = !folderExists
  renderSummary()
}, 250)

// ---------- chapters ----------

const renderChapters = () => {
  const rows = state.chapters.map((c, i) =>
    h(
      'tr',
      { className: c.include ? '' : 'off' },
      h(
        'td',
        {},
        h('input', {
          type: 'checkbox',
          checked: c.include,
          onchange: (e) => {
            c.include = e.target.checked
            renderChapters()
            renderPreviewChapters()
            renderSummary()
          },
        }),
      ),
      h('td', { className: 'num' }, String(i + 1)),
      h(
        'td',
        { className: 'title' },
        h('input', {
          type: 'text',
          value: displayTitle(c),
          readOnly: state.genericTitles && c.include,
          oninput: (e) => {
            c.title = e.target.value
            renderPreviewChapters()
          },
        }),
      ),
      h('td', { className: 'time' }, formatTime(c.start)),
      h('td', { className: 'time' }, formatTime(c.end - c.start)),
      h(
        'td',
        {},
        h('button', { className: 'icon', type: 'button', title: 'Escuchar el inicio (original)', onclick: () => playPreview('original', c.start) }, '▶'),
      ),
    ),
  )
  $('chapter-rows').replaceChildren(...rows)
  $('chapter-count').textContent = `${selectedChapters().length} de ${state.chapters.length} seleccionados`
  $('no-chapters').hidden = (state.probe?.chapters.length ?? 0) > 1
}

const applySplit = async () => {
  const minutes = Number($('split-minutes').value) || 30
  const params = new URLSearchParams({ duration: String(state.probe.duration), minutes: String(minutes) })
  const { chapters } = await api(`/api/split?${params}`)
  state.chapters = chapters.map((c) => ({ ...c, include: true }))
  renderChapters()
  renderPreviewChapters()
  renderSummary()
}

// ---------- audio options & preview ----------

const renderPresets = () => {
  $('presets').replaceChildren(
    ...Object.entries(state.presets).map(([key, preset], i) =>
      h(
        'label',
        { className: 'preset' },
        h('input', { type: 'radio', name: 'preset', value: key, checked: i === 0, onchange: renderSummary }),
        h('span', {}, h('strong', {}, preset.label), h('span', { className: 'muted small block' }, preset.description)),
      ),
    ),
  )
}

const currentPreset = () => document.querySelector('input[name="preset"]:checked')?.value ?? 'soft'

const renderPreviewChapters = () => {
  const select = $('preview-chapter')
  const previous = select.value
  select.replaceChildren(
    ...state.chapters.map((c, i) => h('option', { value: String(i) }, `${i + 1}. ${displayTitle(c) || 'Sin título'}`)),
  )
  if (previous && Number(previous) < state.chapters.length) select.value = previous
}

const previewPoint = () => {
  const chapter = state.chapters[Number($('preview-chapter').value) || 0]
  if (!chapter) return 0
  const offset = Number($('preview-offset').value) || 0
  return Math.min(chapter.start + offset, Math.max(chapter.start, chapter.end - 5))
}

const playPreview = (mode, at = previewPoint()) => {
  const player = $('player')
  const status = $('preview-status')
  status.textContent = mode === 'original' ? 'Preparando original…' : 'Aplicando mejora a 30 s…'
  const params = new URLSearchParams({ file: state.probe.file, mode, at: String(Math.round(at)) })
  player.src = `/api/preview?${params}`
  player.onplaying = () => (status.textContent = `${mode === 'original' ? 'Original' : 'Mejorado'} · desde ${formatTime(at)}`)
  player.onerror = () => (status.textContent = 'No se pudo generar la muestra')
  player.play().catch(() => undefined)
}

// ---------- summary & processing ----------

const renderSummary = () => {
  if (!state.probe) return
  const chapters = selectedChapters()
  const seconds = chapters.reduce((sum, c) => sum + (c.end - c.start), 0)
  const enhance = $('enhance').checked
  $('enhance-options').classList.toggle('disabled', !enhance)
  const selectedBitrate = Number($('bitrate').value)
  const canCopyMp3 = !enhance && state.probe.codec?.toLowerCase() === 'mp3'
  const size = canCopyMp3
    ? state.probe.duration > 0
      ? (state.probe.sizeBytes * seconds) / state.probe.duration
      : 0
    : (seconds * selectedBitrate * 1000) / 8
  const mode = enhance
    ? `con mejora de voz «${state.presets[currentPreset()]?.label ?? ''}» en MP3`
    : canCopyMp3
      ? 'sin mejora de voz (copia MP3 directa)'
      : `sin mejora de voz (recodificado a MP3 ${selectedBitrate} kbps)`
  $('summary-text').textContent = chapters.length
    ? `${chapters.length} ficheros (${formatDuration(seconds)}) ${mode} · ≈ ${formatBytes(size)}${state.probe.cover ? ' + portada' : ''}. Se guardará en output/${$('folder-name').value}/`
    : 'Selecciona al menos un capítulo.'
  $('process').disabled = chapters.length === 0 || state.job?.status === 'running'
}

const startProcess = async () => {
  const chapters = selectedChapters()
  const untitled = chapters.findIndex((c) => !displayTitle(c).trim())
  if (untitled >= 0) return toast('Hay capítulos sin título', true)
  try {
    const job = await api('/api/jobs', {
      method: 'POST',
      body: {
        file: state.probe.file,
        folderName: $('folder-name').value,
        meta: {
          title: $('meta-title').value,
          author: $('meta-author').value,
          narrator: $('meta-narrator').value,
          year: state.probe.meta.year,
          genre: state.probe.meta.genre,
        },
        chapters: chapters.map((c) => ({ title: displayTitle(c).trim(), start: c.start, end: c.end })),
        enhance: $('enhance').checked,
        preset: currentPreset(),
        bitrateKbps: Number($('bitrate').value),
      },
    })
    followJob(job)
  } catch (e) {
    toast(e.message, true)
  }
}

const followJob = (job) => {
  state.job = job
  state.jobSource?.close()
  renderJob()
  const source = new EventSource(`/api/jobs/${job.id}/events`)
  state.jobSource = source
  source.onmessage = (e) => {
    state.job = JSON.parse(e.data)
    renderJob()
    if (state.job.status !== 'running') {
      source.close()
      loadFiles()
      if (state.job.status === 'done') toast('¡Listo! Ya puedes subir la carpeta a Drive.')
    }
  }
}

const renderJob = () => {
  const job = state.job
  if (!job) return
  $('job').hidden = false
  const total = job.chapters.reduce((s, c) => s + c.duration, 0)
  const doneSeconds = job.chapters.reduce((s, c) => s + c.duration * c.progress, 0)
  const ratio = total > 0 ? doneSeconds / total : 0
  const finished = job.chapters.filter((c) => c.status === 'done').length

  const titles = {
    running: `Procesando… ${finished}/${job.chapters.length}`,
    done: `Terminado · ${job.chapters.length} ficheros`,
    error: 'Ha fallado el proceso',
    cancelled: 'Cancelado',
  }
  $('job-title').textContent = titles[job.status]
  const overall = $('job-overall')
  overall.className = `bar big ${job.status === 'done' ? 'done' : job.status === 'error' ? 'error' : ''}`
  overall.firstElementChild.style.width = `${(job.status === 'done' ? 1 : ratio) * 100}%`

  const elapsed = ((job.finishedAt ?? Date.now()) - job.startedAt) / 1000
  if (job.status === 'running' && ratio > 0.02) {
    const remaining = elapsed / ratio - elapsed
    $('job-eta').textContent = `${Math.round(ratio * 100)} % · quedan ≈ ${formatDuration(Math.max(60, remaining))} · velocidad ×${Math.round(doneSeconds / Math.max(1, elapsed))}`
  } else if (job.status === 'done') {
    $('job-eta').textContent = `Tiempo total ${formatTime(elapsed)} · ${job.outputDir}`
  } else {
    $('job-eta').textContent = job.error ?? ''
  }

  const icon = { pending: '·', running: '◌', done: '✓', error: '✕' }
  $('job-chapters').replaceChildren(
    ...job.chapters.map((c) =>
      h(
        'li',
        {},
        h('span', { className: c.status }, icon[c.status]),
        h('span', { className: 'name', title: c.error ?? c.fileName }, c.fileName),
        h(
          'div',
          { className: `bar ${c.status === 'done' ? 'done' : c.status === 'error' ? 'error' : ''}` },
          h('div', { style: `width:${c.progress * 100}%` }),
        ),
      ),
    ),
  )
  $('job-log').textContent = job.log.join('\n')
  $('cancel-job').hidden = job.status !== 'running'
  $('open-output').hidden = job.status !== 'done'
  renderSummary()
}

// ---------- wiring ----------

const init = async () => {
  setupDropzone()
  $('open-input').addEventListener('click', () => openFolder('input'))
  for (const id of ['meta-title', 'meta-author', 'meta-narrator']) {
    $(id).addEventListener('input', () => {
      refreshFolderName()
      renderSummary()
    })
  }
  $('folder-name').addEventListener('input', () => {
    state.folderTouched = true
    $('folder-warning').hidden = !state.outputs.includes($('folder-name').value.trim())
    renderSummary()
  })
  $('select-all').addEventListener('click', () => {
    state.chapters.forEach((c) => (c.include = true))
    renderChapters()
    renderPreviewChapters()
    renderSummary()
  })
  $('select-none').addEventListener('click', () => {
    state.chapters.forEach((c) => (c.include = false))
    renderChapters()
    renderPreviewChapters()
    renderSummary()
  })
  $('generic-titles').addEventListener('change', (e) => {
    state.genericTitles = e.target.checked
    renderChapters()
    renderPreviewChapters()
  })
  $('apply-split').addEventListener('click', applySplit)
  $('enhance').addEventListener('change', renderSummary)
  $('bitrate').addEventListener('change', renderSummary)
  $('play-original').addEventListener('click', () => playPreview('original'))
  $('play-enhanced').addEventListener('click', () => playPreview(currentPreset()))
  $('process').addEventListener('click', startProcess)
  $('cancel-job').addEventListener('click', () => api(`/api/jobs/${state.job.id}/cancel`, { method: 'POST' }))
  $('open-output').addEventListener('click', () => openFolder('output', state.job.folderName))

  try {
    await loadStatus()
    await loadFiles()
  } catch (e) {
    toast(e.message, true)
  }
}

init()

export interface TabEditDraft {
    title: string
    alias: string
    label: string
    status: string
    scheduled: string
    automatic: boolean
}

/** Draft-only UI: the caller applies changes together after explicit Save. */
export function openTabEditDialog (options: {
    initial: TabEditDraft
    focus?: 'title' | 'alias' | 'scheduled' | 'label'
    ui: (key: string) => string
    statuses: Array<{ value: string; label: string }>
    validateAlias: (value: string) => string
    save: (draft: TabEditDraft) => Promise<void>
    closed: () => void
}): HTMLDialogElement {
    const { initial, ui } = options
    const dialog = document.createElement('dialog')
    dialog.className = 'ad-tab-edit'
    const heading = document.createElement('h2')
    heading.id = 'ad-tab-edit-heading'
    heading.textContent = ui('편집')
    dialog.setAttribute('aria-labelledby', heading.id)
    const form = document.createElement('form')
    form.noValidate = true
    const field = (key: string, name: string, control: HTMLInputElement | HTMLSelectElement) => {
        const label = document.createElement('label')
        label.className = 'ad-edit-field'
        const caption = document.createElement('span')
        caption.textContent = ui(key)
        control.name = name
        control.className = 'ad-edit-' + name
        label.append(caption, control)
        form.append(label)
        return control
    }
    const input = (key: string, name: 'title' | 'alias' | 'label', max: number) => {
        const control = document.createElement('input')
        control.type = 'text'
        control.value = initial[name]
        control.maxLength = max
        control.autocomplete = 'off'
        field(key, name, control)
        return control
    }
    const title = input('탭 제목', 'title', 160)
    const alias = input('별명', 'alias', 40)
    const label = input('작업 이름', 'label', 500)
    const status = document.createElement('select')
    for (const item of options.statuses) {
        const option = document.createElement('option')
        option.value = item.value; option.textContent = item.label
        status.append(option)
    }
    status.value = initial.status
    field('상태', 'status', status)
    const scheduled = document.createElement('input')
    scheduled.type = 'number'; scheduled.min = '0'; scheduled.max = '999999'; scheduled.step = '1'
    scheduled.value = initial.scheduled
    field('예약 건수', 'scheduled', scheduled)
    const automatic = document.createElement('input')
    automatic.type = 'checkbox'; automatic.checked = initial.automatic
    automatic.className = 'ad-edit-automatic'
    const autoLabel = document.createElement('label')
    autoLabel.className = 'ad-edit-auto'
    autoLabel.append(automatic, document.createTextNode(ui('예약 건수 자동 집계로')))
    const note = document.createElement('p')
    note.className = 'ad-edit-note'
    note.textContent = ui('수동 설정 · 실제 예약은 변경되지 않습니다')
    scheduled.disabled = automatic.checked
    automatic.addEventListener('change', () => { scheduled.disabled = automatic.checked })
    const error = document.createElement('p')
    error.className = 'ad-edit-error'; error.setAttribute('role', 'alert'); error.hidden = true
    const actions = document.createElement('div')
    actions.className = 'ad-edit-actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'; cancel.className = 'ad-edit-cancel'; cancel.textContent = ui('취소')
    const save = document.createElement('button')
    save.type = 'submit'; save.className = 'ad-edit-save'; save.textContent = ui('저장')
    actions.append(cancel, save)
    form.append(autoLabel, note, error, actions)
    dialog.append(heading, form)
    let busy = false, composing = false
    const controls = [title, alias, label, status, scheduled, automatic, cancel, save]
    cancel.addEventListener('click', () => { if (!busy) { dialog.close('cancel') } })
    dialog.addEventListener('cancel', event => { if (busy) { event.preventDefault() } })
    dialog.addEventListener('close', () => { dialog.remove(); options.closed() }, { once: true })
    dialog.addEventListener('compositionstart', () => { composing = true })
    dialog.addEventListener('compositionend', () => { composing = false })
    dialog.addEventListener('keydown', event => {
        event.stopPropagation()
        if (event.key === 'Enter' && (composing || event.isComposing || event.keyCode === 229)) { event.preventDefault() }
        if (event.key === 'Escape' && !composing && !event.isComposing) {
            event.preventDefault()
            if (!busy) { dialog.close('cancel') }
        }
    })
    for (const control of [alias, scheduled]) { control.addEventListener('input', () => control.setCustomValidity('')) }
    form.addEventListener('submit', async event => {
        event.preventDefault()
        if (busy || composing) { return }
        alias.setCustomValidity(options.validateAlias(alias.value.trim()))
        scheduled.setCustomValidity(!automatic.checked && !/^\d{1,6}$/.test(scheduled.value)
            ? ui('0 이상의 정수를 입력하세요') : '')
        if (!form.reportValidity()) { return }
        const draft = { title: title.value.trim(), alias: alias.value.trim(), label: label.value.trim(),
            status: status.value, scheduled: scheduled.value, automatic: automatic.checked }
        busy = true; error.hidden = true
        for (const control of controls) { control.disabled = true }
        try {
            await options.save(draft)
            dialog.close('save')
        } catch {
            error.textContent = ui('변경 내용을 저장하지 못했습니다. 다시 시도하세요.')
            error.hidden = false
        } finally {
            busy = false
            for (const control of controls) { control.disabled = false }
            scheduled.disabled = automatic.checked
        }
    })
    document.body.append(dialog)
    dialog.showModal()
    const focused = { title, alias, label, scheduled }[options.focus || 'title']
    if (focused.disabled) { automatic.focus() } else { focused.focus(); focused.select() }
    return dialog
}

import * as path from 'path'
import * as os from 'os'
import { HistoryHit, HistorySource, SessionSearch } from './sessionSearch'
import { ResumeRow } from './sessionLedger'

interface HistoryHost {
    sources (): Promise<HistorySource[]>
    resume (row: ResumeRow): void
    changed (): void
    korean (): boolean
    searchLabel (): string
}

/** Local history UI. It has no dependency on the session messaging/MCP service. */
export class SessionSearchPanel {
    readonly element = document.createElement('div')
    private input = document.createElement('input')
    private status = document.createElement('div')
    private results = document.createElement('div')
    private engine = new SessionSearch(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'), 'tabby-agentdeck','history-search'))
    private previewEngine = new SessionSearch(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'), 'tabby-agentdeck','history-search'))
    private generation = 0
    private timer: ReturnType<typeof setTimeout> | null = null
    private hits: HistoryHit[] = []
    private visible = 40
    private dialog: HTMLElement | null = null
    private previewGeneration = 0
    private errors = ''
    private tr (ko: string, en: string): string { return this.host.korean() ? ko : en }

    constructor (private host: HistoryHost) {
        this.element.className = 'ad-history-search'
        this.input.type = 'search'; this.input.className = 'ad-history-query'
        this.input.placeholder = this.host.searchLabel()
        this.input.setAttribute('aria-label',this.input.placeholder)
        this.input.addEventListener('input', () => {
            if (this.timer) { clearTimeout(this.timer) }
            this.generation++; this.engine.cancel(); this.hits = []; this.results.replaceChildren()
            this.status.textContent = this.active ? this.tr('검색 준비 중…','Preparing search…') : ''
            this.host.changed()
            if (this.active) { this.timer = setTimeout(() => { void this.search() }, 300) }
        })
        this.element.addEventListener('keydown', e => {
            e.stopPropagation()
            if (e.key === 'Escape' && this.input.value) {
                e.preventDefault(); this.input.value = ''; this.input.dispatchEvent(new Event('input'))
            } else if (e.key === 'Enter' && e.target === this.input) {
                e.preventDefault(); if (this.timer) { clearTimeout(this.timer) }; void this.search()
            }
        })
        this.status.className='ad-history-status';this.status.setAttribute('aria-live','polite')
        this.results.className='ad-history-results'
        this.element.append(this.input,this.status,this.results)
        window.addEventListener('beforeunload',()=>this.dispose(),{once:true})
    }

    get active (): boolean { return !!this.input.value.trim() }
    update (expanded: boolean): void {
        this.element.hidden = !expanded
        this.input.placeholder = this.host.searchLabel()
        this.input.setAttribute('aria-label', this.input.placeholder)
    }
    private async search (): Promise<void> {
        const query=this.input.value.trim(), generation=++this.generation
        this.errors='';this.visible=40
        if (!query) { return }
        this.status.textContent=this.tr('대화 기록 확인 중…','Finding conversation files…')
        try {
            const sources=await this.host.sources()
            if (generation!==this.generation) { return }
            const result=await this.engine.search(sources,query,(done,total)=>{
                if(generation===this.generation)this.status.textContent=this.tr(`검색 중 ${done}/${total}`,`Searching ${done}/${total}`)
            })
            if(generation!==this.generation)return
            this.hits=result.hits
            if(result.unreadable || result.malformed)this.errors=this.tr(` · 읽지 못한 파일 ${result.unreadable}, 불완전한 기록 ${result.malformed}`,` · ${result.unreadable} unreadable files, ${result.malformed} incomplete records`)
            this.renderResults()
        } catch(error:any) {
            if(generation===this.generation)this.status.textContent=this.tr('검색 실패: ','Search failed: ')+String(error.message || error)
        }
    }

    private highlight (el: HTMLElement, text: string): void {
        const query=this.input.value.trim().toLowerCase()
        if(!query){el.textContent=text;return}
        let start=0, at:number
        const lower=text.toLowerCase()
        while((at=lower.indexOf(query,start))>=0){
            el.append(document.createTextNode(text.slice(start,at)))
            const mark=document.createElement('mark');mark.textContent=text.slice(at,at+query.length);el.append(mark)
            start=at+query.length
        }
        el.append(document.createTextNode(text.slice(start)))
    }

    private renderResults (): void {
        this.results.replaceChildren()
        if(!this.active){this.status.textContent='';return}
        const hits=this.hits
        this.status.textContent=this.tr(`${hits.length}개 세션`,`${hits.length} sessions`)+this.errors
        if(!hits.length)this.status.textContent=this.tr('일치하는 지난 대화가 없습니다','No matching conversations')+this.errors
        for(const hit of hits.slice(0,this.visible)){
            const button=document.createElement('button');button.type='button';button.className='ad-history-hit'
            button.dataset.sessionId=hit.source.sessionId
            const title=document.createElement('strong');this.highlight(title,hit.record.label || hit.source.sessionId)
            const meta=document.createElement('small')
            meta.textContent=`${hit.source.agent==='codex'?'Codex':'Claude'} · ${new Date(hit.record.lastSeen).toLocaleDateString()} · ${hit.count}`
            const folder=document.createElement('small');folder.textContent=hit.record.cwd || ''
            const excerpt=document.createElement('span');this.highlight(excerpt,hit.snippet)
            button.append(title,meta,folder,excerpt)
            button.addEventListener('click',()=>{void this.openPreview(hit,hit.line)})
            this.results.append(button)
        }
        if(hits.length>this.visible){
            const more=document.createElement('button');more.type='button';more.textContent=this.tr('더 보기','Show more')
            more.onclick=()=>{this.visible+=40;this.renderResults()};this.results.append(more)
        }
    }

    private async openPreview (hit: HistoryHit, line: number): Promise<void> {
        const token=++this.previewGeneration
        this.dialog?.remove()
        const overlay=document.createElement('div');overlay.className='ad-history-overlay';this.dialog=overlay
        const panel=document.createElement('section');panel.className='ad-history-dialog';panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true')
        panel.setAttribute('aria-label',this.tr('지난 대화 보기','Conversation preview'));panel.tabIndex=-1
        const head=document.createElement('header'), title=document.createElement('strong'), close=document.createElement('button')
        title.textContent=hit.record.label || hit.source.sessionId;close.textContent='×';close.setAttribute('aria-label',this.tr('닫기','Close'))
        const dismiss=()=>{this.previewGeneration++;this.previewEngine.cancel();overlay.remove();if(this.dialog===overlay)this.dialog=null;this.input.focus()}
        close.onclick=dismiss;head.append(title,close)
        const body=document.createElement('div');body.className='ad-history-conversation';body.textContent=this.tr('불러오는 중…','Loading…')
        const footer=document.createElement('footer'),resume=document.createElement('button')
        resume.textContent=this.tr('이어서 대화','Resume conversation')
        resume.onclick=()=>{dismiss();this.host.resume({...hit.record,openTabId:null})}
        footer.append(resume);panel.append(head,body,footer);overlay.append(panel);document.body.append(overlay);close.focus()
        overlay.addEventListener('keydown',e=>{
            e.stopPropagation()
            if(e.key==='Escape'){e.preventDefault();dismiss()}
            if(e.key==='Tab'){
                const controls=Array.from(panel.querySelectorAll<HTMLElement>('button,input,select,textarea,[tabindex="0"]'))
                const first=controls[0],last=controls[controls.length-1]
                if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus()}
                else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus()}
            }
        })
        overlay.addEventListener('click',e=>{if(e.target===overlay)dismiss()})
        try{
            const data=await this.previewEngine.preview(hit.source,line)
            if(token!==this.previewGeneration)return
            body.replaceChildren()
            for(const msg of data.messages){
                const section=document.createElement('article');section.className=msg.line===line?'ad-history-match':''
                const role=document.createElement('strong');role.textContent=msg.role==='user'?this.tr('나','You'):hit.source.agent
                const text=document.createElement('pre');this.highlight(text,msg.text.slice(0,16000));section.append(role,text)
                if(msg.text.length>16000){const more=document.createElement('button');more.textContent=this.tr('메시지 전체 보기','Show full message');more.onclick=()=>{text.replaceChildren();this.highlight(text,msg.text);more.remove()};section.append(more)}
                body.append(section)
            }
            for(const [target,ko,en] of [[data.previous,'이전 대화','Previous messages'],[data.next,'다음 대화','Next messages']] as const){
                if(target!==null){const btn=document.createElement('button');btn.textContent=this.tr(ko,en);btn.onclick=()=>{void this.openPreview(hit,target)};footer.prepend(btn)}
            }
            body.querySelector('.ad-history-match')?.scrollIntoView({block:'nearest'})
        }catch(error:any){if(token===this.previewGeneration)body.textContent=this.tr('기록을 읽지 못했습니다: ','Could not read conversation: ')+String(error.message || error)}
    }

    dispose (): void {
        this.generation++;this.previewGeneration++
        if(this.timer)clearTimeout(this.timer)
        this.engine.cancel();this.previewEngine.cancel();this.dialog?.remove()
    }
}

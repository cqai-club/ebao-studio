import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { initialProject, type ResearchModelServices } from '../src/generation.ts'
import { API, parseRunRequest, type StreamEvent } from '../src/protocol.ts'
import { saveProject } from '../src/store.ts'
import { createRouteHandler } from '../src/routes.ts'

const roots: string[] = []
const servers: ReturnType<typeof createServer>[] = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
  await Promise.all(roots.splice(0).map(root => rm(root, {recursive:true, force:true})))
})
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'eyanbao-review-')); roots.push(root)
  const fetcher = vi.fn(async () => { throw new Error('不得重新检索') })
  const stream = vi.fn(async function* () { yield {type:'text-delta', text:'# 综述\n\n来源内容待核查。'}; yield {type:'finish', reason:{kind:'stop'}} })
  const handler = createRouteHandler({projectRoot:root, fetcher:fetcher as unknown as typeof fetch, services:()=>({defaultModel:{currentSelection:()=>({provider:'demo',model:'demo'})}, llm:{stream} as unknown as ResearchModelServices['llm']})})
  const server = createServer((req,res) => { void handler(req,res) }); servers.push(server)
  await new Promise<void>(resolve => server.listen(0,'127.0.0.1',resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${API}/run`
  const seed = initialProject(parseRunRequest({prompt:'检索研究文献', kind:'search'}))
  const search = await saveProject({...seed, status:'complete', sources:[{id:'one',title:'第一篇',authors:['甲'],source:'openalex'},{id:'two',title:'第二篇',authors:['乙'],source:'crossref'}]}, {root})
  const send = (data: unknown) => fetch(base,{method:'POST',headers:{'content-type':'application/json','x-eyanbao':'1'},body:JSON.stringify(data)})
  const request = {kind:'review',prompt:'梳理研究领域的文献',sourceProjectId:search.id,selectedSourceIds:['two']}
  return {search,root,send,request,fetcher}
}
it('综述只使用检索项目中明确选定的文献，并且不重新联网', async () => {
  const {send,request,fetcher} = await setup()
  const response = await send(request)
  expect(response.status).toBe(200)
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line) as StreamEvent)
  const result = events.find(event => event.type === 'result')
  if (result?.type !== 'result') throw new Error('缺少结果')
  expect(result.project.sources.map(source => source.id)).toEqual(['two'])
  expect(fetcher).not.toHaveBeenCalled()
})
it('拒绝无选择、他人文献、重复文献、非综述调用与未完成的项目', async () => {
  const {send,request,search,root} = await setup()
  for (const body of [
    {kind:'review',prompt:'梳理研究领域的文献'},
    {...request,selectedSourceIds:[]},
    {...request,selectedSourceIds:['fake']},
    {...request,selectedSourceIds:['one','one']},
    {...request,kind:'journal'},
  ]) expect((await send(body)).status).toBe(400)
  await saveProject({...search,status:'draft'},{root})
  expect((await send(request)).status).toBe(400)
})

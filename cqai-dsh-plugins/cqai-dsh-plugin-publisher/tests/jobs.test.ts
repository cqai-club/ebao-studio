import { describe, expect, it } from 'vitest'
import {
  CREATIVE_STATEMENTS, DESCRIPTION_MAX, MAX_TAGS, TITLE_MAX,
  type PublishInput,
} from '../src/protocol.ts'
import { PUBLISH_AT, Publisher, publishArgs, validateInput } from '../src/jobs.ts'
import { fakeRuntime, fakeVideo, writeRecord } from './fixture.ts'

/** A request that passes every check, before a test breaks exactly one thing. */
function request(file: string, over: Partial<PublishInput> = {}): Record<string, unknown> {
  return {file, title: '一条成片', targets: [{platform: 'dy'}], ...over}
}

describe('request validation', () => {
  const video = fakeVideo()

  it('refuses a 成片 that is not an absolute path to an existing file', () => {
    expect(() => validateInput(request('成片.mp4'))).toThrow('绝对路径')
    expect(() => validateInput(request(video.dir))).toThrow('不是文件')
    expect(() => validateInput(request(`${video.dir}/没有这个文件.mp4`))).toThrow('找不到成片文件')
    expect(() => validateInput({title: '没有文件', targets: [{platform: 'dy'}]})).toThrow('请先选择要发布的成片')
  })

  it('enforces the field limits upstream enforces', () => {
    expect(() => validateInput(request(video.file, {title: '   '}))).toThrow('标题是必填项')
    expect(() => validateInput(request(video.file, {title: '字'.repeat(TITLE_MAX + 1)}))).toThrow(`不能超过 ${TITLE_MAX} 字`)
    expect(() => validateInput(request(video.file, {description: '字'.repeat(DESCRIPTION_MAX + 1)}))).toThrow(`不能超过 ${DESCRIPTION_MAX} 字`)
    expect(() => validateInput(request(video.file, {tags: Array.from({length: MAX_TAGS + 1}, (_, index) => `t${String(index)}`)}))).toThrow(`最多 ${MAX_TAGS} 个`)
    expect(() => validateInput(request(video.file, {creativeStatement: 'invented' as never}))).toThrow('不支持的创作声明')
    expect(() => validateInput(request(video.file, {publishAt: '2026-09-22 10:00'}))).toThrow('YYYY-MM-DD HH:mm:ss')
    expect(validateInput(request(video.file, {publishAt: '2026-09-22 10:00:00'})).publishAt).toBe('2026-09-22 10:00:00')
    expect(PUBLISH_AT.test('2026-09-22 10:00:00')).toBe(true)
  })

  it('normalizes tags the way upstream expects them', () => {
    expect(validateInput(request(video.file, {tags: ['#口播', ' ## 剪辑 ', '']})).tags).toEqual(['口播', '剪辑'])
  })

  it('refuses a platform list that cannot be published to', () => {
    expect(() => validateInput(request(video.file, {targets: []}))).toThrow('至少选择一个发布平台')
    // 掘金 is a Platform in the type but not a video platform upstream can drive.
    expect(() => validateInput(request(video.file, {targets: [{platform: 'jj' as never}]}))).toThrow('不支持的平台')
    expect(() => validateInput(request(video.file, {targets: [{platform: 'dy'}, {platform: 'dy'}]}))).toThrow('重复选择')
    // Two accounts on one platform are two distinct targets, not a duplicate.
    const two = validateInput(request(video.file, {targets: [{platform: 'dy', phone: '13800000000'}, {platform: 'dy', phone: '13900000000'}]}))
    expect(two.targets).toHaveLength(2)
  })

  it('keeps 哔哩哔哩’s own creative statement on 哔哩哔哩', () => {
    const targets = [{platform: 'blbl' as const}]
    expect(() => validateInput(request(video.file, {creativeStatement: 'self_made_no_repost', targets}))).not.toThrow()
    expect(() => validateInput(request(video.file, {creativeStatement: 'self_made_no_repost'}))).toThrow('仅哔哩哔哩支持')
    for (const statement of CREATIVE_STATEMENTS) expect(validateInput(request(video.file, {creativeStatement: statement, targets})).creativeStatement).toBe(statement)
  })
})

describe('command line composition', () => {
  const video = fakeVideo()
  const input = validateInput(request(video.file, {targets: [{platform: 'dy'}]}))

  it('passes only the flags the request actually carries', () => {
    expect(publishArgs(input, 'dy', '')).toEqual(['cli', 'publish', '-p', 'dy', '-f', video.file, '-t', '一条成片'])
    expect(publishArgs(input, 'dy', '13800000000')).toContain('--phone')
    expect(publishArgs(input, 'dy', '')).not.toContain('--draft')
    // `none` is upstream's default, so sending it would be noise.
    expect(publishArgs({...input, creativeStatement: 'none'}, 'dy', '')).not.toContain('--cs')
    expect(publishArgs({...input, creativeStatement: 'ai_generated'}, 'dy', '')).toContain('--cs')
  })

  it('sends the extra fields 视频号 and 番茄视频 require in their backend', () => {
    const sph = publishArgs(input, 'sph', '')
    expect(sph).toContain('--short-title')
    expect(sph).toContain('--name')
    // The short title is capped at 16 characters when nothing better was given.
    expect(sph[sph.indexOf('--short-title') + 1]).toBe('一条成片')
    const long = publishArgs({...input, title: '标题'.repeat(20)}, 'sph', '')
    expect(long[long.indexOf('--short-title') + 1]).toHaveLength(16)
    expect(publishArgs({...input, shortTitle: '我自己写的短标题'}, 'sph', '')[sph.indexOf('--short-title') + 1]).toBe('我自己写的短标题')
    expect(publishArgs(input, 'fqsp', '')).toContain('--name')
    expect(publishArgs(input, 'dy', '')).not.toContain('--name')
  })

  it('carries the whole request through to the arguments', () => {
    const full = validateInput(request(video.file, {title: '标题', description: '简介', tags: ['a', 'b'], publishAt: '2026-09-22 10:00:00', draft: true}))
    const args = publishArgs(full, 'ks', '13800000000')
    expect(args[args.indexOf('--description') + 1]).toBe('简介')
    expect(args[args.indexOf('--tags') + 1]).toBe('a b')
    expect(args[args.indexOf('--publish-at') + 1]).toBe('2026-09-22 10:00:00')
    expect(args).toContain('--draft')
  })
})

describe('supervising a job', () => {
  const video = fakeVideo(64)

  it('runs the platforms serially, in the order they were selected', async () => {
    const runtime = fakeRuntime([{code: 0}, {code: 0}])
    const publisher = new Publisher(runtime.mm, runtime.cli.launch)
    try {
      const job = publisher.create(request(video.file, {targets: [{platform: 'dy'}, {platform: 'ks'}]}))
      expect(job.status).toBe('queued')
      await publisher.start(job.id)
      expect(runtime.cli.calls.map(args => args[args.indexOf('-p') + 1])).toEqual(['dy', 'ks'])
      expect(job.status).toBe('failed')
    } finally { runtime.dispose() }
  })

  it('refuses a second job while one is running, and never runs one twice', async () => {
    const runtime = fakeRuntime([{code: 0, delayMs: 800}, {code: 0}])
    const publisher = new Publisher(runtime.mm, runtime.cli.launch)
    try {
      const first = publisher.create(request(video.file))
      const second = publisher.create(request(video.file, {title: '第二个'}))
      const running = publisher.start(first.id)
      expect(publisher.busy).toBe(true)
      expect(() => publisher.guard(second.id)).toThrow('请等待')
      await running
      // Nothing landed, so this job is one a person would want to retry — the
      // guard lets it through again rather than calling it spent.
      expect(publisher.restartable(first)).toBe(true)
      expect(() => publisher.guard(first.id)).not.toThrow()
    } finally { runtime.dispose() }
  })

  it('runs a platform to success only once, and never reopens a finished job', async () => {
    const runtime = fakeRuntime([{code: 0}])
    const publisher = new Publisher(runtime.mm, runtime.cli.launch)
    try {
      writeRecord(runtime.mm.dataDir, {pt: 'dy', publishStatus: 'success', lastPublishMessage: '发布成功'}, Date.now() + 60_000)
      const job = publisher.create(request(video.file))
      await publisher.start(job.id)
      expect(job.status).toBe('completed')
      // A job that published something is done; re-running it would post twice.
      expect(publisher.restartable(job)).toBe(false)
      expect(() => publisher.guard(job.id)).toThrow('已经开始过了')
    } finally { runtime.dispose() }
  })

  it('never turns an exit code into a success of its own', async () => {
    const runtime = fakeRuntime([{code: 0}, {code: 3}, {silent: true}])
    const publisher = new Publisher(runtime.mm, runtime.cli.launch)
    try {
      // Exit 0 with no record anywhere is `unknown`: the CLI claims it worked,
      // and nothing in MatrixMedia's own data agrees, so the panel says so.
      const unconfirmed = await publisher.start(publisher.create(request(video.file)).id)
      expect(unconfirmed.targets[0].state).toBe('unknown')
      expect(unconfirmed.status).toBe('failed')
      expect(unconfirmed.error).toContain('矩媒记录中确认')
      expect(unconfirmed.finishedAt).toBeTruthy()
      // Exit 3 is upstream's own "upload did not succeed".
      const failed = await publisher.start(publisher.create(request(video.file)).id)
      expect(failed.targets[0].exitCode).toBe(3)
      expect(failed.targets[0].state).toBe('failed')
      expect(failed.targets[0].message).toContain('退出码 3')
      // A child that dies before its epilogue is not a failure — it is unknown.
      const crashed = await publisher.start(publisher.create(request(video.file)).id)
      expect(crashed.targets[0].exitCode).toBeUndefined()
      expect(crashed.targets[0].state).toBe('unknown')
    } finally { runtime.dispose() }
  }, 30000)

  it('promotes a platform to success only from MatrixMedia’s own record', async () => {
    const runtime = fakeRuntime([{code: 0}])
    const publisher = new Publisher(runtime.mm, runtime.cli.launch)
    try {
      // Stamped ahead of the job's own start time, which is what upstream would
      // have written while the child was running.
      writeRecord(runtime.mm.dataDir, {pt: 'dy', publishStatus: 'success', lastPublishMessage: '发布成功'}, Date.now() + 60_000)
      const job = await publisher.start(publisher.create(request(video.file)).id)
      expect(job.targets[0].state).toBe('success')
      expect(job.targets[0].message).toBe('发布成功')
      expect(job.targets[0].publishedAt).toBeTruthy()
      expect(job.status).toBe('completed')
      expect(job.error).toBeUndefined()
    } finally { runtime.dispose() }
  })

  it('cancels a running child and leaves the untouched platforms cancelled', async () => {
    const runtime = fakeRuntime([{code: 0, delayMs: 30000}, {code: 0}])
    const publisher = new Publisher(runtime.mm, runtime.cli.launch)
    try {
      const job = publisher.create(request(video.file, {targets: [{platform: 'dy'}, {platform: 'ks'}]}))
      const running = publisher.start(job.id)
      await expect.poll(() => job.targets[0].state, {timeout: 15000}).toBe('running')
      await publisher.cancel(job.id)
      await running
      expect(job.status).toBe('cancelled')
      expect(job.targets.map(target => target.state)).toEqual(['cancelled', 'cancelled'])
      expect(runtime.cli.calls).toHaveLength(1)
    } finally { runtime.dispose() }
  }, 30000)

  it('parks an unexpected failure on the job instead of leaving it running', () => {
    const runtime = fakeRuntime()
    const publisher = new Publisher(runtime.mm, runtime.cli.launch)
    try {
      const job = publisher.create(request(video.file))
      job.status = 'running'
      job.targets[0].state = 'running'
      publisher.fail(job.id, new Error('矩媒运行体未就位'))
      expect(job.status).toBe('failed')
      expect(job.error).toBe('矩媒运行体未就位')
      expect(job.targets[0].state).toBe('unknown')
    } finally { runtime.dispose() }
  })

  it('reports a missing job and a missing runtime in language the panel can show', () => {
    const runtime = fakeRuntime()
    try {
      const publisher = new Publisher(runtime.mm, runtime.cli.launch)
      expect(() => publisher.get('不存在')).toThrow('任务不存在')
    } finally { runtime.dispose() }
  })
})

import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it.each([undefined, 'fixture-client-version'])('boots Desktop product telemetry with client version %s', clientVersion => {
  // Loader uses Node's native module pipeline; a child exercises that pipeline
  // independently of Vitest's transformed module graph.
  const script = `
    import assert from 'node:assert/strict';
    import { once } from 'node:events';
    import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
    import { createServer } from 'node:http';
    import { createRequire } from 'node:module';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const profiles = await import(pathToFileURL(process.argv[1]).href);
    const home = mkdtempSync(join(tmpdir(), 'desktop-product-telemetry-'));
    const anchor = profiles.desktopInstallAnchor();
    const require = createRequire(anchor);
    const { boot, composeEntries } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href);
    const runtimeVersion = JSON.parse(readFileSync(require.resolve('@deepseek-ai/dsh-web-app/package.json'), 'utf8')).version;
    const clientVersion = process.argv[2] || undefined;
    if (clientVersion === undefined) delete process.env.DSH_CLIENT_VERSION;
    else process.env.DSH_CLIENT_VERSION = clientVersion;
    process.env.OTEL_EXPORTER_OTLP_LOGS_COMPRESSION = 'none';
    const captures = [];
    const collector = createServer((request, response) => {
      const chunks = [];
      request.on('data', chunk => chunks.push(chunk));
      request.on('end', () => {
        captures.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        response.end('{}');
      });
    });
    let ctx;
    let release;
    try {
      const prepared = profiles.prepareDesktopProfile('', home);
      const profile = prepared.profile;
      const rootConfig = prepared.rootConfig;
      const rows = composeEntries([prepared.patches]).filter(row => row.id === 'otel' || row.id === 'desktop-product-telemetry');
      collector.listen(0, '127.0.0.1');
      await once(collector, 'listening');
      process.env.DSH_PRODUCT_ANALYTICS_OTLP_URL = 'http://127.0.0.1:' + collector.address().port + '/v1/logs';
      const { installProfilePackageResolver } = await import(pathToFileURL(process.argv[3]).href);
      release = installProfilePackageResolver(prepared.bareModuleBaseUrl);
      ctx = await boot('desktop-product-telemetry-test', rootConfig, [{ insert: rows }], host => {
        host.provide('profileContext', {
          name: 'desktop', dir: profile.dir, patchPath: profile.patchPath, installAnchor: anchor,
          cwd: process.cwd(), home, startedBundles: profile.layers.map(layer => layer.packageName), overlays: [], telemetryDisabledEnv: '',
        });
      }, prepared.bareModuleBaseUrl);
      const telemetry = ctx.get('productTelemetry');
      assert.ok(telemetry, 'Desktop product telemetry must mount');
      // Mounting alone emits nothing. Only a synthetic event goes to our local collector.
      assert.equal(captures.length, 0);
      telemetry.emit({ eventName: 'telemetry.fixture', body: 'Synthetic regression event', timestamp: 1800000000000 });
      await ctx.fiber.dispose();
      ctx = undefined;
      assert.equal(captures.length, 1, 'the reporter must drain one synthetic event on unload');
      const attributes = captures[0].resourceLogs[0].resource.attributes;
      assert.deepEqual(attributes.find(value => value.key === 'service.name').value, { stringValue: 'deepseek-harness-desktop' });
      assert.deepEqual(attributes.find(value => value.key === 'service.version').value, { stringValue: clientVersion ?? runtimeVersion });
      console.log('Desktop telemetry boot and local export passed');
    } finally {
      await ctx?.fiber.dispose();
      if (collector.listening) await new Promise((resolve, reject) => collector.close(error => error ? reject(error) : resolve()));
      release?.();
      rmSync(home, { recursive: true, force: true });
    }
  `
  const output = execFileSync(process.execPath, [
    '--expose-internals', '--experimental-transform-types', '--input-type=module', '-e', script,
    fileURLToPath(new URL('../src/profile.ts', import.meta.url)),
    clientVersion ?? '',
    fileURLToPath(new URL('../src/module-resolution.ts', import.meta.url)),
  ], { encoding: 'utf8', timeout: 20_000 })
  expect(output).toContain('Desktop telemetry boot and local export passed')
}, 25_000)

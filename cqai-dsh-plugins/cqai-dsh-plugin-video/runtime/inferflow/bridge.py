"""Private stdio adapter; credentials never appear in argv or output."""
import contextlib
import io
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from inferflow_client import InferFlowClient
from run_skill import prepare_inputs, validate_local_inputs_for_dry_run, mode_estimate_for_dry_run

def execute(req):
    client = InferFlowClient(req['key'], 'https://saas.inferflow.dev/openapi/v1')
    op = req['op']
    if op == 'verify':
        credits = client.get_credits()
        client.get_skill('digital_human_standard')
        return {'connected': True, 'credits': credits}
    if op in ('quote', 'prepare'):
        skill = client.get_skill('digital_human_standard')
        raw = req['inputs']
        planned = validate_local_inputs_for_dry_run(skill, raw)
        if op == 'quote':
            client.get_credits()
            billing = skill.get('billing') or {}
            if not billing.get('unit_credits') or not billing.get('min_billable_units'):
                raise ValueError('InferFlow 未返回公开计费标准，暂不能确认费用')
            return mode_estimate_for_dry_run(skill, planned)
        return prepare_inputs(client, skill, raw)
    if op == 'create':
        return client.create_skill_run('digital_human_standard', req['inputs'], idempotency_key=req['requestId'])
    if op == 'status':
        return client.get_run(req['runId'])
    if op == 'outputs':
        return client.list_outputs(req['runId'])
    raise ValueError('Unknown operation')

if __name__ == '__main__':
    req = json.load(sys.stdin)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            result = execute(req)
        print(json.dumps({'result': result}, ensure_ascii=False))
    except (Exception, SystemExit) as exc:
        message = str(exc).replace(req.get('key', ''), '[redacted]')
        print(json.dumps({'error': message}, ensure_ascii=False))
        sys.exit(1)

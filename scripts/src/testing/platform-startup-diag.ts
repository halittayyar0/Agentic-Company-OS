import {spawn} from 'node:child_process';
import {prepareLocalTestEnvironment} from '../test-environment';
const environment=await prepareLocalTestEnvironment(process.env);
const child=spawn(process.execPath,['--no-wasm-code-gc','--import','tsx','--test','--test-timeout=60000','--test-concurrency=2','artifacts/api-server/src/lib/codex-app-server-client.test.ts','artifacts/api-server/src/lib/codex-task-service.test.ts','artifacts/api-server/src/lib/vm/windows-owned-job.test.ts'],{env:environment,stdio:'inherit',windowsHide:true});
child.once('error',()=>{process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});

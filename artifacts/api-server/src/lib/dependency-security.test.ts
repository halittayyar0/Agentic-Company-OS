import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { z } from "zod";
import * as mini from "zod/v4-mini";

test("bounded collections reject oversized input before classic or Mini element validation", () => {
  const schemas = [
    [
      "classic",
      (count: () => void) => z.array(z.string().superRefine(count)).max(2),
    ],
    [
      "Mini",
      (count: () => void) =>
        mini
          .array(
            mini.string().check(
              mini.refine(() => {
                count();
                return true;
              }),
            ),
          )
          .check(mini.maxLength(2)),
    ],
  ] as const;
  for (const [entryPoint, makeSchema] of schemas) {
    let validated = 0;
    const schema = makeSchema(() => {
      validated++;
    });
    const oversized = schema.safeParse(["one", "two", "three"]);
    assert.equal(oversized.success, false, entryPoint);
    assert.equal(validated, 0, `${entryPoint} must check the bound first`);
    assert.equal(schema.safeParse(["valid"]).success, true, entryPoint);
    assert.equal(
      validated,
      1,
      `${entryPoint} still validates accepted elements`,
    );
  }
});

test("compressed JSON trailing bytes cannot terminate the HTTP process", async () => {
  // Keep a vulnerable decoder's uncaught error inside a disposable child.
  // Exercise the same Express JSON parser used by the production API, with
  // normal parsing and a subsequent HTTP liveness check as positive controls.
  const script = `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import {gzipSync} from 'node:zlib';
    import express from ${JSON.stringify(import.meta.resolve("express"))};
    const app=express();
    app.use(express.json({limit:'1mb'}));
    app.post('/echo',(req,res)=>res.json(req.body));
    app.get('/health',(_req,res)=>res.json({healthy:true}));
    const server=app.listen(0,'127.0.0.1');
    await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject)});
    const port=server.address().port;
    const request=(route,body,encoding)=>new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port,path:route,method:body?'POST':'GET',agent:false,headers:body?{'Content-Type':'application/json','Content-Length':body.length,...(encoding?{'Content-Encoding':encoding}:{})}:{}},res=>{
        let text='';res.setEncoding('utf8');res.on('data',chunk=>text+=chunk);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(text)}));
      });
      req.setTimeout(5000,()=>req.destroy(new Error('bounded_request_timeout')));req.on('error',reject);req.end(body);
    });
    try {
      const value={message:'finite local request'};
      assert.deepEqual(await request('/echo',Buffer.from(JSON.stringify(value))),{status:200,body:value});
      const payload=Buffer.concat([gzipSync(JSON.stringify(value)),Buffer.from([0]),Buffer.alloc(100*1024,0x58)]);
      assert.deepEqual(await request('/echo',payload,'gzip'),{status:200,body:value});
      // The vulnerable stream throws after the successful response, when its
      // trailing input reaches the already-finished decompressor.
      await new Promise(resolve=>setTimeout(resolve,200));
      assert.deepEqual(await request('/health'),{status:200,body:{healthy:true}});
      console.log(JSON.stringify({normalJson:true,compressedTrailingBytes:true,subsequentHealth:true}));
    } finally {
      await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    }
  `;
  const { stdout } = await promisify(execFile)(
    process.execPath,
    ["--input-type=module", "-e", script],
    { windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024 },
  );
  assert.deepEqual(JSON.parse(stdout.trim()), {
    normalJson: true,
    compressedTrailingBytes: true,
    subsequentHealth: true,
  });
});

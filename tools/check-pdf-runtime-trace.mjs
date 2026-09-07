import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { verifyPdfRuntimeTrace } from './pdf-runtime-tracing.mjs';

const root = process.cwd();
const trace = path.resolve(root, process.argv[2] || '.next/server/app/packet/[request_id]/pdf/route.js.nft.json');
const result = verifyPdfRuntimeTrace(root, trace);
const output = process.argv[3];
if (output) fs.writeFileSync(path.resolve(root, output), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`PDF Next trace verified: ${result.packages.length} packages, ${result.required.length} required files, ${result.required_bytes} required bytes.\n`);

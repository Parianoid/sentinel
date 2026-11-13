import { readFile } from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export async function GET(){const yaml=await readFile(path.join(process.cwd(),"openapi.yaml"),"utf8");return new Response(yaml,{headers:{"Content-Type":"application/yaml; charset=utf-8","Content-Disposition":"inline; filename=sentinel-openapi.yaml"}})}

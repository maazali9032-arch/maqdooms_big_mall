import fs from "node:fs/promises";
import assert from "node:assert/strict";
export async function functionSQL(file, name) {
  const text=(await fs.readFile(file,'utf8')).replaceAll('\r\n','\n');
  const start=[...text.matchAll(new RegExp('CREATE (?:OR REPLACE )?FUNCTION public\\.'+name+'\\(','g'))].at(-1)?.index??-1;
  assert(start>=0,'Missing function '+name);
  const opening=/\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(text.slice(start));
  assert(opening,'Missing function body '+name);
  const body=start+opening.index+opening[0].length;
  const closing=text.indexOf(opening[1],body);
  assert(closing>=body);
  const end=text.indexOf(';',closing+opening[1].length)+1;
  return text.slice(start,end).replace(/^CREATE (?:OR REPLACE )?FUNCTION/,'CREATE OR REPLACE FUNCTION');
}
export async function mirrorMigration(timestamp,index,name,sql) {
  sql=sql.replace(/[ \t]+$/gm,'');
  await fs.writeFile(`supabase/migrations/${timestamp}_${name}.sql`,sql);
  await fs.writeFile(`drizzle/migrations/${index}_${name}.sql`,sql);
}

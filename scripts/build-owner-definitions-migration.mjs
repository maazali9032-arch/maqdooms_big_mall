import fs from 'node:fs/promises';
import {mirrorMigration} from './workflow-sql.mjs';
await mirrorMigration('20261015000600','0048','owner_definitions','BEGIN;\n'+await fs.readFile('scripts/owner-definitions-schema.sql','utf8')+"\nNOTIFY pgrst,'reload schema';\nCOMMIT;\n");

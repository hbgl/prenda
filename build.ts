import { execSync } from 'child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

function exec(cmd: string) {
  return execSync(cmd, { stdio: ['ignore', 'inherit', 'inherit'] });
}

// Delete old files.
exec('npx rimraf ./dist');

// Transpile typescript.
exec('npx tsc --project tsconfig.build.json');

// Copy files to dist.
['LICENSE', 'README.md', 'API.md', 'config.example.yaml', 'package.json'].forEach(f =>
  copyFileSync(f, path.join('dist', f))
);

// Modify package.json for deployment.
const packageJson = JSON.parse(readFileSync('./dist/package.json').toString());
delete packageJson.private;
writeFileSync('./dist/package.json', JSON.stringify(packageJson, undefined, 4));

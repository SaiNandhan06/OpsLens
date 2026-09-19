import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const repoDir = path.resolve('packages/data/src/repositories');
const repoFiles = fs.readdirSync(repoDir).filter((f) => f.endsWith('.ts'));

console.log('[Check 6] Verifying tenantId as first parameter on all repository methods...\n');

let violations = 0;
let totalMethods = 0;

for (const file of repoFiles) {
  const filePath = path.join(repoDir, file);
  const sourceCode = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

  ts.forEachChild(sourceFile, (node) => {
    if (ts.isClassDeclaration(node) && node.name) {
      const className = node.name.text;
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.name && ts.isIdentifier(member.name)) {
          totalMethods++;
          const methodName = member.name.text;
          const firstParam = member.parameters[0];
          const firstParamName = firstParam && ts.isIdentifier(firstParam.name) ? firstParam.name.text : undefined;

          if (firstParamName !== 'tenantId') {
            violations++;
            console.error(`VIOLATION: ${className}.${methodName} does not have 'tenantId' as first parameter! (Found: ${firstParamName ?? 'none'})`);
          } else {
            console.log(`PASS: ${className}.${methodName}(tenantId: ${firstParam?.type ? firstParam.type.getText(sourceFile) : 'string'}, ...)`);
          }
        }
      }
    }
  });
}

console.log(`\nSummary: Verified ${totalMethods} methods across ${repoFiles.length} repository classes.`);
console.log(`Violations found: ${violations}`);

if (violations > 0) {
  process.exit(1);
}

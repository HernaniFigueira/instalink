// Auditoria reproduzível: inventário dos callbacks + funções locais alcançáveis.
// Além do contrato SyncMutation/tsc, detecta Promise ignorada (sem return/await).
import ts from 'typescript';
import path from 'node:path';
const root = process.cwd();
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const violations = new Set();
const reachable = new Set();
const roots = [];
const isProduct = (sf) => sf.fileName.startsWith(path.join(root, 'src') + '/') && !sf.fileName.includes('/__tests__/') && !sf.isDeclarationFile;
const location = (n) => `${path.relative(root, n.getSourceFile().fileName)}:${n.getSourceFile().getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
function promiseLike(type) { return type.isUnion() ? type.types.some(promiseLike) : !!type.getProperty('then'); }
function inspect(node) {
  if (reachable.has(node)) return;
  reachable.add(node);
  if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) violations.add(`${location(node)} async na seção protegida`);
  function visit(n) {
    if (ts.isAwaitExpression(n)) violations.add(`${location(n)} await na seção protegida`);
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      if (promiseLike(checker.getTypeAtLocation(n))) violations.add(`${location(n)} Promise/I/O alcançável: ${n.expression.getText().slice(0, 90)}`);
      if (['fetch', 'setTimeout', 'setInterval', 'setImmediate'].includes(n.expression.getText())) violations.add(`${location(n)} I/O/agendamento alcançável: ${n.expression.getText()}`);
      const callee = checker.getResolvedSignature(n)?.declaration;
      if (callee?.body && isProduct(callee.getSourceFile())) inspect(callee);
    }
    ts.forEachChild(n, visit);
  }
  if (node.body) visit(node.body);
  else visit(node);
}
for (const sf of program.getSourceFiles().filter(isProduct)) {
  function visit(n) {
    if (ts.isCallExpression(n) && ['updateDB', 'updateDBWithCas'].includes(n.expression.getText())) {
      const callback = n.arguments[0];
      roots.push(`${location(n)} ${n.expression.getText()}`);
      inspect(callback);
      // Guards CAS também rodam sob a fronteira síncrona.
      if (n.arguments[1] && ts.isObjectLiteralExpression(n.arguments[1])) {
        for (const prop of n.arguments[1].properties) if (ts.isPropertyAssignment(prop) && prop.name.getText() === 'guard') inspect(prop.initializer);
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
}
console.log(roots.join('\n'));
console.log(`\n${roots.length} callbacks; ${reachable.size} callbacks/funções locais auditados transitivamente.`);
if (violations.size) { console.error([...violations].join('\n')); process.exitCode = 1; }
else console.log('OK: nenhuma Promise, await, HTTP ou timer alcançável nos callbacks auditados.');
